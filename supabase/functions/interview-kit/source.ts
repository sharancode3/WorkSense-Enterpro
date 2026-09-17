import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit, fitKey } from "../_shared/skill-graph-engine.ts";
import { callQwen, QwenError } from "../_shared/qwen.ts";

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
  let jobId: string | null = null;
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
  if (!twinId || !reqId) return json({ error: "VALIDATION_ERROR", message: "twin_id and req_id are required." }, 400);

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

  // Durable job lifecycle for the (expensive) kit generation.
  const jobStartedAt = Date.now();
  const inputHash = hashJobInput(`${twinId}|${reqId}`);
  const open = await findOpenJob(supabase, caller.org_id, caller.id, "interview_kit", inputHash);
  if (open) {
    return json({ error: "CONFLICT", message: "An interview kit for this candidate and role is already being generated.", job_id: open.id }, 409);
  }
  const job = await createJob(supabase, {
    orgId: caller.org_id, actorId: caller.id, task: "interview_kit", inputHash,
    promptVersion: "interview-kit-v1", model: QWEN_MODEL,
  });
  jobId = job.id;
  await markJobRunning(supabase, job.id);

  // 1) Reuse cached rubrics; generate any missing competencies (cached per role).
  const required = (reqRow.required_skills ?? []) as { skill: string; target_proficiency: number }[];
  let rubrics = (reqRow.rubrics ?? []) as { competency: string }[];
  const have = new Set(rubrics.map((r) => r.competency.toLowerCase()));
  const missing = [...required.map((r) => r.skill), "Collaboration"].filter((c) => !have.has(c.toLowerCase()));

  // Batch all missing competencies into ONE generation call (local 4B model:
  // avoid numerous sequential generations unnecessarily).
  if (missing.length > 0) {
    const parsed = (await callQwen({
      json: true,
      temperature: 0.3,
      maxTokens: 2400,
      task: "interview_kit_rubrics",
      system:
        'You are the WorkSense Interview Architect. For each given competency, generate one question, two follow-up probes, and a strict 5-tier OBSERVABLE behavioral rubric (concrete behaviors, not adjectives). Tier 1 = concrete red-flag behavior. Tier 3 = solid role-baseline behavior. Tier 5 = master/architectural-level behavior.\nRespond with JSON only:\n{"rubrics":[{"competency":"string","question":"string","follow_up_probes":["string","string"],"rubric":{"tier_1":"string","tier_2":"string","tier_3":"string","tier_4":"string","tier_5":"string"}}]}',
      user: `Role: ${reqRow.title}. Competencies: ${missing.join(", ")}. Produce the rubrics array as JSON.`,
    })) as { rubrics?: unknown[] };

    for (const item of parsed.rubrics ?? []) {
      const valid = validateRubric(item);
      if (!valid.ok) throw new QwenError("MODEL_OUTPUT_INVALID", `Rubric failed validation: ${valid.errors.join("; ")}`);
      const r = item as { competency?: string; question?: string; follow_up_probes?: string[]; rubric: Record<string, string> };
      const name = (r.competency ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
      if (!name) continue;
      rubrics = rubrics.filter((x) => x.competency.toLowerCase() !== name.toLowerCase());
      rubrics.push({ competency: name, question: r.question ?? "", follow_up_probes: (r.follow_up_probes ?? []).slice(0, 2), rubric: r.rubric });
    }
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
      task: "interview_kit_probe",
      system: BIAS_SYSTEM,
      user: `Role: ${reqRow.title}. Candidate's Adjacent/Transferable/Gap items: ${focusItems.map((i) => i.skill).join(", ")}. Bias the question toward the top item and produce the rubric JSON.`,
    })) as unknown;
    const valid = validateRubric(parsed);
    if (!valid.ok) throw new QwenError("MODEL_OUTPUT_INVALID", `Biased probe failed validation: ${valid.errors.join("; ")}`);
    biasedProbe = shapeRubric(parsed as { competency?: string; question?: string; follow_up_probes?: string[]; rubric?: Partial<Record<(typeof TIER_KEYS)[number], string>> }, focusItems[0].skill);
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

  await finishJob(supabase, job.id, { status: "succeeded", output: { score: fit.score, focus_items: kit.focus_items }, latencyMs: Date.now() - jobStartedAt });

  return json({ ok: true, job_id: job.id, status: "succeeded", kit });
  } catch (err) {
    if (jobId) {
      await finishJob(supabase, jobId, { status: "failed", errorCode: err instanceof QwenError ? err.code : "INTERNAL", errorMessage: err instanceof Error ? err.message : "unknown" }).catch(() => undefined);
    }
    return json({ error: err instanceof QwenError ? err.code : "INTERNAL", message: err instanceof Error ? err.message : "unknown" });
  }
});