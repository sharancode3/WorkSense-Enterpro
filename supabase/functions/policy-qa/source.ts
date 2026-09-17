import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { callQwen, sanitizeUntrusted, wrapUntrusted } from "../_shared/qwen.ts";
import { ABSTENTION_THRESHOLD, retrieveChunks, validateCitations, type PolicyDoc } from "../_shared/policy-retrieval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GROUNDING_SYSTEM = `You are a grounded HR policy assistant.
Answer ONLY from the provided <policy_chunks>. Each chunk is tagged with its doc_code, section heading and text.
If the chunks do not contain the answer, return status "insufficient_evidence" with an empty answer and empty citations.
Never invent policies, numbers, quotes, or approval flows that are not in the chunks.
For every factual claim provide a citation with an EXACT short quote copied verbatim from a chunk's text.
Respond with JSON only:
{"status":"grounded"|"partially_supported"|"insufficient_evidence","answer":"string","citations":[{"claim":"string","doc_code":"string","section":"string","quote":"string"}],"note":"string"}
Use "grounded" only when every claim has a verbatim quote. Use "partially_supported" when some claims lack a verbatim quote.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHORIZED" }, 401);

  let body: { question?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const raw = String(body.question ?? "").trim();
  if (raw.length < 5) return json({ error: "BAD_REQUEST", message: "Ask a real question (min 5 characters)." }, 400);

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
  })) as {
    status?: string;
    answer?: string;
    citations?: { claim?: string; doc_code?: string; section?: string; quote?: string }[];
    note?: string;
  };

  // 4) Never let an ungrounded answer through: every quote must exist verbatim
  // in a retrieved chunk. Dropped citations downgrade the confidence state.
  const { valid, droppedCount } = validateCitations(parsed.citations, retrieval);
  const answer = String(parsed.answer ?? "").trim();
  let status = parsed.status === "partially_supported" ? "partially_supported" : "grounded";

  if (status === "grounded" && droppedCount > 0) status = "partially_supported";
  if (answer.length === 0 || (valid.length === 0 && droppedCount > 0)) status = "insufficient_evidence";

  if (status === "insufficient_evidence") {
    return json({
      status: "insufficient_evidence",
      abstained: false,
      best_score: retrieval[0].score,
      threshold: ABSTENTION_THRESHOLD,
      answer: "",
      citations: [],
      retrieval,
      note: parsed.note ?? "The model could not answer from the retrieved chunks.",
    });
  }

  return json({
    status,
    abstained: false,
    best_score: retrieval[0].score,
    threshold: ABSTENTION_THRESHOLD,
    answer,
    citations: valid,
    retrieval,
    note: parsed.note ?? "",
  });
});
