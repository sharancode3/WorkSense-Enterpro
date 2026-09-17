import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit, fitKey } from "../_shared/skill-graph-engine.ts";
import { callQwen } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BIAS_SYSTEM = `You are the WorkSense Interview Architect. For the given role, competency, and the candidate's specific Adjacent/Transferable/Gap items, generate one question, two follow-up probes, and a strict 5-tier OBSERVABLE behavioral rubric (concrete behaviors, not adjectives). Tier 1 = concrete red-flag behavior. Tier 3 = solid role-baseline behavior. Tier 5 = master/architectural-level behavior. Bias the question toward probing the candidate's specific adjacent/transferable claim, not a generic question.
Respond with JSON only:
{"competency":"string","question":"string","follow_up_probes":["string","string"],
"rubric":{"tier_1":"string","tier_2":"string","tier_3":"string","tier_4":"string","tier_5":"string"}}`;

const TIER_KEYS = ["tier_1", "tier_2", "tier_3", "tier_4", "tier_5"] as const;

function shapeRubric(parsed: { competency?: string; question?: string; follow_up_probes?: string[]; rubric?: Partial<Record<(typeof TIER_KEYS)[number], string>> }, fallbackComp: string) {
  return {
    competency: (parsed.competency ?? fallbackComp).replace(/\s*\(.*\)\s*$/, "").trim() || fallbackComp,
    question: parsed.question ?? `Tell me about your experience with ${fallbackComp}.`,
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
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !["hr_executive", "recruiter"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
  }

  let body: { twin_id?: string; req_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const twinId = (body.twin_id ?? "").trim();
  const reqId = (body.req_id ?? "").trim();
  if (!twinId || !reqId) return json({ error: "BAD_REQUEST", message: "twin_id and req_id are required." }, 400);

  const { data: twin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, role, org_id, name, verified_skills, seniority_level, computed_fits, audit_events, interview_rubrics")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !twin || twin.role !== "candidate") return json({ error: "NOT_FOUND" }, 404);

  const { data: reqRow, error: reqErr } = await supabase
    .from("job_requisitions")
    .select("id, org_id, title, required_skills, future_skills, seniority_level, rubrics, audit_events")
    .eq("id", reqId)
    .maybeSingle();
  if (reqErr || !reqRow) return json({ error: "NOT_FOUND" }, 404);
  if (reqRow.org_id !== caller.org_id || reqRow.org_id !== twin.org_id) return json({ error: "FORBIDDEN" }, 403);

  // 1) Reuse cached rubrics; generate any missing competencies (cached per role).
  const required = (reqRow.required_skills ?? []) as { skill: string; target_proficiency: number }[];
  let rubrics = (reqRow.rubrics ?? []) as { competency: string }[];
  const have = new Set(rubrics.map((r) => r.competency.toLowerCase()));
  const missing = [...required.map((r) => r.skill), "Collaboration"].filter((c) => !have.has(c.toLowerCase()));
  for (const comp of missing) {
    const target = required.find((r) => r.skill.toLowerCase() === comp.toLowerCase())?.target_proficiency ?? 3;
    const parsed = (await callQwen({
      json: true,
      temperature: 0.3,
      maxTokens: 1200,
      system:
        'You are the WorkSense Interview Architect. For the given role and competency, generate one question, two follow-up probes, and a strict 5-tier OBSERVABLE behavioral rubric (concrete behaviors, not adjectives). Tier 1 = concrete red-flag behavior. Tier 3 = solid role-baseline behavior. Tier 5 = master/architectural-level behavior.\nRespond with JSON only:\n{"competency":"string","question":"string","follow_up_probes":["string","string"],"rubric":{"tier_1":"string","tier_2":"string","tier_3":"string","tier_4":"string","tier_5":"string"}}',
      user: `Role: ${reqRow.title}. Competency: ${comp} (required proficiency ${target} of 5). Produce the rubric as JSON.`,
    })) as { competency?: string; question?: string; follow_up_probes?: string[]; rubric?: Partial<Record<(typeof TIER_KEYS)[number], string>> };
    const name = shapeRubric(parsed, comp).competency;
    rubrics = rubrics.filter((r) => r.competency.toLowerCase() !== name.toLowerCase());
    rubrics.push(shapeRubric(parsed, comp));
  }
  if (missing.length > 0) {
    await supabase.from("job_requisitions").update({ rubrics }).eq("id", reqId);
  }

  // 2) Fit card (persisted) — reuse the Skill Graph output to bias the probes.
  const fits = (twin.computed_fits ?? []) as { target_id: string; scenario: string; score: number; classification: { adjacent: { skill: string }[]; transferable: { skill: string }[]; gaps: { skill: string }[] } }[];
  let fit = fits.find((f) => f.target_id === reqId && f.scenario === "current");
  if (!fit) {
    const { data: graphRows } = await supabase
      .from("skill_graph")
      .select("skill, category, outgoing_edges")
      .eq("org_id", twin.org_id);
    const now = new Date().toISOString();
    fit = computeFit({
      candidateSkills: twin.verified_skills ?? [],
      candidateLevel: twin.seniority_level ?? 3,
      requiredSkills: reqRow.required_skills ?? [],
      roleLevel: reqRow.seniority_level ?? 3,
      skillGraph: graphRows ?? [],
      target: { type: "requisition", id: reqRow.id, title: reqRow.title },
      scenario: "current",
      computedAt: now,
    }) as unknown as typeof fit;
    await supabase
      .from("digital_twins")
      .update({
        computed_fits: [...fits.filter((f) => !(f.target_id === reqId && f.scenario === "current")), fit],
        audit_events: [
          ...(twin.audit_events ?? []),
          { actor: caller.email ?? uid, action: "match_computed", note: `Match vs ${reqRow.title}: ${fit.score.toFixed(3)}`, timestamp: now },
        ],
      })
      .eq("id", twinId);
  }

  const focusItems = [...(fit.classification.gaps ?? []), ...(fit.classification.adjacent ?? []), ...(fit.classification.transferable ?? [])].slice(0, 3);

  // One 6.2 call, biased toward the candidate's top focus item from their Fit card.
  let biasedProbe: { competency: string; question: string; follow_up_probes: string[]; rubric: Record<string, string> } | null = null;
  if (focusItems.length > 0) {
    const parsed = (await callQwen({
      json: true,
      temperature: 0.3,
      maxTokens: 900,
      system: BIAS_SYSTEM,
      user: `Role: ${reqRow.title}. Candidate's Adjacent/Transferable/Gap items: ${focusItems.map((i) => i.skill).join(", ")}. Bias the question toward the top item and produce the rubric JSON.`,
    })) as { competency?: string; question?: string; follow_up_probes?: string[]; rubric?: Partial<Record<(typeof TIER_KEYS)[number], string>> };
    biasedProbe = shapeRubric(parsed, focusItems[0].skill);
  }

  const kit = {
    type: "interview_kit",
    req_id: reqRow.id,
    req_title: reqRow.title,
    candidate_name: twin.name,
    score: fit.score,
    focus_items: focusItems.map((i) => i.skill),
    biased_probe: biasedProbe,
    competencies: rubrics,
    created_at: new Date().toISOString(),
  };

  const now = new Date().toISOString();
  await supabase
    .from("digital_twins")
    .update({
      interview_rubrics: [...(twin.interview_rubrics ?? []), kit],
      audit_events: [
        ...(twin.audit_events ?? []),
        { actor: caller.email ?? uid, action: "interview_kit_generated", note: `Interview kit for ${reqRow.title} (score ${fit.score.toFixed(2)}).`, timestamp: now },
      ],
    })
    .eq("id", twinId);

  return json({ ok: true, kit });
});
