import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { callQwen, QwenError } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RUBRIC_SYSTEM = `You are the WorkSense Interview Architect. For the given role and competency, generate one question, two follow-up probes, and a strict 5-tier OBSERVABLE behavioral rubric (concrete behaviors, not adjectives). Tier 1 = concrete red-flag behavior. Tier 3 = solid role-baseline behavior. Tier 5 = master/architectural-level behavior.
Respond with JSON only:
{"competency":"string","question":"string","follow_up_probes":["string","string"],
"rubric":{"tier_1":"string","tier_2":"string","tier_3":"string","tier_4":"string","tier_5":"string"}}`;

const TIER_KEYS = ["tier_1", "tier_2", "tier_3", "tier_4", "tier_5"] as const;

async function generateRubric(supabase, reqRow: { id: string; title: string; required_skills: { skill: string; target_proficiency: number }[] }, competency: string, target: number) {
  const parsed = (await callQwen({
    json: true,
    temperature: 0.3,
    maxTokens: 1200,
    task: "rubric",
    system: RUBRIC_SYSTEM,
    user: `Role: ${reqRow.title}. Competency: ${competency} (required proficiency ${target} of 5).\nProduce the 5-tier behavioral interview rubric as JSON.`,
  })) as {
    competency?: string;
    question?: string;
    follow_up_probes?: string[];
    rubric?: Partial<Record<(typeof TIER_KEYS)[number], string>>;
  };

  const valid = validateRubric(parsed);
  if (valid.ok === false) throw new QwenError("MODEL_OUTPUT_INVALID", `Rubric failed validation: ${valid.errors.join("; ")}`);
  return {
    competency: (parsed.competency ?? competency).replace(/\s*\(.*\)\s*$/, "").trim() || competency,
    question: parsed.question ?? `Tell me about your experience with ${competency}.`,
    follow_up_probes: (parsed.follow_up_probes ?? []).slice(0, 2),
    rubric: {
      tier_1: parsed.rubric?.tier_1 ?? "",
      tier_2: parsed.rubric?.tier_2 ?? "",
      tier_3: parsed.rubric?.tier_3 ?? "",
      tier_4: parsed.rubric?.tier_4 ?? "",
      tier_5: parsed.rubric?.tier_5 ?? "",
    },
  };
}

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
    .select("id, role, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !["hr_executive", "recruiter"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
  }

  let body: { req_id?: string; competencies?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const reqId = (body.req_id ?? "").trim();
  if (!reqId) return json({ error: "VALIDATION_ERROR", message: "req_id is required." }, 400);

  const { data: reqRow, error: reqErr } = await supabase
    .from("job_requisitions")
    .select("id, org_id, title, required_skills, rubrics, audit_events")
    .eq("id", reqId)
    .maybeSingle();
  if (reqErr || !reqRow) return json({ error: "NOT_FOUND", message: "Requisition not found." }, 404);
  if (reqRow.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  const required = (reqRow.required_skills ?? []) as { skill: string; target_proficiency: number }[];
  const wanted = (body.competencies?.length ? body.competencies : [...required.map((r) => r.skill), "Collaboration"]);

  const existing = (reqRow.rubrics ?? []) as { competency: string }[];
  const have = new Set(existing.map((r) => r.competency.toLowerCase()));
  const rubrics = [...existing];

  for (const comp of wanted) {
    const target = required.find((r) => r.skill.toLowerCase() === comp.toLowerCase())?.target_proficiency ?? 3;
    if (have.has(comp.toLowerCase())) continue; // cached — reuse, don't regenerate per candidate
    const rubric = await generateRubric(supabase, reqRow, comp, target);
    const name = rubric.competency.toLowerCase();
    if (have.has(name)) {
      // Replace the stale/badly-named entry rather than duplicate.
      const i = rubrics.findIndex((r) => r.competency.toLowerCase() === name);
      rubrics[i] = rubric;
    } else {
      rubrics.push(rubric);
    }
    have.add(name);
  }

  const now = new Date().toISOString();
  await supabase
    .from("job_requisitions")
    .update({
      rubrics,
      audit_events: [
        ...(reqRow.audit_events ?? []),
        { actor: caller.id, action: "rubrics_generated", note: `Cached ${wanted.length} competency rubrics for ${reqRow.title}.`, timestamp: now },
      ],
    })
    .eq("id", reqId);

  return json({ ok: true, rubrics });
  } catch (err) {
    return json({ error: err instanceof QwenError ? err.code : "INTERNAL", message: err instanceof Error ? err.message : "unknown" });
  }
});