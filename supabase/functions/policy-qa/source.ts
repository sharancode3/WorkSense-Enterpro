import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { callQwen, QwenError, sanitizeUntrusted, wrapUntrusted } from "../_shared/qwen.ts";
import { ABSTENTION_THRESHOLD, retrieveChunks, validateCitations, type PolicyDoc } from "../_shared/policy-retrieval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GROUNDING_SYSTEM = `You are the WorkSense HR Policy Reasoning Agent. Answer using ONLY the provided policy excerpts. If they do not contain the answer, set status to "insufficient_evidence" and say so plainly — never invent a policy. Every claim must cite doc_code, section, and a short exact quote.
Respond with JSON only:
{"status":"grounded_response|insufficient_evidence","answer":"string","citations":[{"doc_code":"string","section":"string","exact_quote":"string"}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: { question?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const raw = String(body.question ?? "").trim();
  if (raw.length < 5) return json({ error: "VALIDATION_ERROR", message: "Ask a real question (min 5 characters)." }, 400);

  // Untrusted input handling: neutralize instruction-like phrases.
  const question = sanitizeUntrusted(raw);

  const { data: org } = await supabase
    .from("organizations")
    .select("policies")
    .eq("id", caller.org_id)
    .maybeSingle();
  const policies = (org?.policies ?? []) as PolicyDoc[];

  // 1) DETERMINISTIC retrieval — zero LLM credits.
  const retrieval = retrieveChunks(policies, question, 3);

  // 2) CALIBRATED ABSTENTION GATE — before any model call.
  if (retrieval.length === 0 || retrieval[0].score < ABSTENTION_THRESHOLD) {
    return json({
      status: "insufficient_evidence",
      abstained: true,
      best_score: retrieval[0]?.score ?? 0,
      threshold: ABSTENTION_THRESHOLD,
      answer: "",
      citations: [],
      retrieval,
    });
  }

  // 3) ONE grounded Qwen call per question that clears the threshold.
  const chunksText = retrieval
    .map((c) => `[${c.doc_code} ${c.section_code}] ${c.heading}
${c.text}`)
    .join("\n\n");

  const parsed = (await callQwen({
    json: true,
    temperature: 0.1,
    maxTokens: 900,
    system: GROUNDING_SYSTEM,
    user: `<policy_chunks>
${chunksText}
</policy_chunks>

Question (untrusted): ${wrapUntrusted(question)}`,
  })) as unknown;
  const valid = validatePolicyAnswer(parsed);
  if (!valid.ok) throw new QwenError("MODEL_OUTPUT_INVALID", `Policy answer failed validation: ${valid.errors.join("; ")}`);
  const typed = parsed as { status?: string; answer?: string; citations?: { doc_code?: string; section?: string; exact_quote?: string }[] };

  // Never let an ungrounded answer through: every exact_quote must exist
  // verbatim in a retrieved chunk. Dropped citations downgrade the state.
  const { valid: validCits, droppedCount } = validateCitations(typed.citations, retrieval);
  const answer = String(typed.answer ?? "").trim();
  let status: "grounded" | "partially_supported" | "insufficient_evidence" =
    typed.status === "grounded_response" ? "grounded" : "insufficient_evidence";

  if (status === "grounded" && droppedCount > 0) status = "partially_supported";
  if (answer.length === 0 || (validCits.length === 0 && droppedCount > 0)) status = "insufficient_evidence";

  if (status === "insufficient_evidence") {
    return json({
      status: "insufficient_evidence",
      abstained: false,
      best_score: retrieval[0].score,
      threshold: ABSTENTION_THRESHOLD,
      answer: "",
      citations: [],
      retrieval,
      note: "The model could not answer from the retrieved chunks.",
    });
  }

  return json({
    status,
    abstained: false,
    best_score: retrieval[0].score,
    threshold: ABSTENTION_THRESHOLD,
    answer,
    citations: validCits,
    retrieval,
  });
  } catch (err) {
    return json({ error: err instanceof QwenError ? err.code : "INTERNAL", message: err instanceof Error ? err.message : "unknown" });
  }
});