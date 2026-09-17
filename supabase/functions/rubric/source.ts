import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { callQwen } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RUBRIC_SYSTEM = `You design 5-tier behavioral interview rubrics.
Respond with JSON only, exactly this shape:
{"competency":"string","question":"string","levels":[
{"tier":"Red Flag","criteria":["string"]},
{"tier":"Developing","criteria":["string"]},
{"tier":"Competent-Baseline","criteria":["string"]},
{"tier":"Advanced","criteria":["string"]},
{"tier":"Master-Architectural","criteria":["string"]}]}
Criteria must be observable behaviors. Do not reference candidates, resumes, or anything outside the competency.`;

const TIER_LABELS = ["Red Flag", "Developing", "Competent-Baseline", "Advanced", "Master-Architectural"];

async function generateRubric(supabase, reqRow: { id: string; title: string; required_skills: { skill: string; target_proficiency: number }[] }, competency: string, target: number) {
  const parsed = (await callQwen({
    json: true,
    temperature: 0.3,
    maxTokens: 1200,
    system: RUBRIC_SYSTEM,
    user: `Role: ${reqRow.title}. Competency: ${competency} (required proficiency ${target} of 5).\nProduce the 5-tier behavioral interview rubric as JSON.`,
  })) as { competency?: string; question?: string; levels?: { tier?: string; criteria?: string[] }[] };

  const levels = TIER_LABELS.map((label, i) => ({
    tier: label,
    criteria: (parsed.levels ?? []).find((l) => l.tier === label)?.criteria ?? [],
  }));

  return {
    competency: (parsed.competency ?? competency).replace(/\s*\(.*\)\s*$/, "").trim() || competency,
    question: parsed.question ?? `Tell me about your experience with ${competency}.`,
    levels,
  };
}

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
  if (!reqId) return json({ error: "BAD_REQUEST", message: "req_id is required." }, 400);

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
});
