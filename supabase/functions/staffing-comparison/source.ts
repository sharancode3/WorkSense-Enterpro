import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit, type GraphSkill } from "../_shared/skill-graph-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ---------------------------------------------------------------------------
// Phase 14 — Staffing planner (Hire / Move / Upskill / Hybrid).
// Deterministic planning estimates built from live records (requisition skills,
// applicant match scores, employee verified skills via the skill engine) plus
// EXPLICITLY LABELED demo assumptions for cost/time. These are planning
// estimates — never guarantees of hiring quality, cost, or readiness.
// ---------------------------------------------------------------------------

// Demo scenario: "a backend project needs a ready team in six weeks."
const DEADLINE_DAYS = 42;

// Planning assumptions — visible in the payload and the UI. Demo-only numbers.
const ASSUMPTIONS = {
  deadline_days: DEADLINE_DAYS,
  hire: {
    time_to_ready_days: 56, // search + notice + onboarding
    cost_usd: 45000, // fee + onboarding; demo assumption
    note: "External search, notice period and onboarding take longer than the 42-day window — flagged as a constraint.",
  },
  move: {
    time_to_ready_days: 21,
    cost_usd: 6000,
    note: "Internal move: manager approval, handover and focused retraining. Requires a backfill decision.",
  },
  upskill: {
    time_to_ready_days: 42,
    cost_usd: 2400,
    note: "Focused training plus evidence verification. Trained skills are claims until verified — the planner says so, not the trainer.",
  },
};

const DEFAULT_REQ_TITLE = "Senior Backend Engineer";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    return await handle(req);
  } catch (err) {
    console.error("[staffing-comparison]", err instanceof Error ? err.stack ?? err.message : String(err));
    return json({ error: "INTERNAL", message: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);
  if (!["hr_executive", "hr_partner", "manager"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Staffing planner requires HR or Manager access." }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const reqTitle = typeof body.requisition_title === "string" && body.requisition_title.trim()
    ? body.requisition_title.trim() : DEFAULT_REQ_TITLE;

  const [reqRes, twinsRes, graphRes] = await Promise.all([
    supabase.from("job_requisitions")
      .select("id, title, department, seniority_level, required_skills, future_skills, applicants, status")
      .eq("org_id", caller.org_id)
      .eq("status", "open"),
    supabase.from("digital_twins")
      .select("id, name, role, status, department, seniority_level, verified_skills")
      .eq("org_id", caller.org_id),
    supabase.from("skill_graph").select("skill, category, outgoing_edges").eq("org_id", caller.org_id),
  ]);

  const reqs = (reqRes.data ?? []) as {
    id: string; title: string; department: string; seniority_level: number;
    required_skills: { skill: string; target_proficiency: number }[];
    future_skills: { skill: string; target_proficiency: number }[];
    applicants: { twin_id: string; stage: string; match_score: number | null }[];
    status: string;
  }[];
  const requisition = reqs.find((r) => r.title.toLowerCase() === reqTitle.toLowerCase()) ?? reqs[0];
  if (!requisition) return json({ ok: false, error: "NO_REQUISITION", message: "No open requisition found for the staffing scenario." }, 404);

  const graph = ((graphRes as { data?: unknown[] } | null)?.data ?? []) as GraphSkill[];
  const workers = (twinsRes.data ?? []).filter((t) => t.status === "active" && ["employee", "manager"].includes(t.role));

  const fitFor = (twin: { id: string; seniority_level?: number | null; verified_skills?: unknown[] }) =>
    computeFit({
      candidateSkills: (twin.verified_skills ?? []) as { name: string; proficiency: number; evidence_source: string; verification_rigor: "low" | "medium" | "high" }[],
      candidateLevel: twin.seniority_level ?? 3,
      requiredSkills: requisition.required_skills,
      roleLevel: requisition.seniority_level,
      skillGraph: graph,
      target: { type: "requisition", id: requisition.id, title: requisition.title },
      scenario: "current",
    });

  // Rank every worker by current fit; used by move/upskill/hybrid.
  const ranked = workers
    .map((w) => ({ twin: w, fit: fitFor(w) }))
    .sort((a, b) => b.fit.score - a.fit.score);

  const pct = (n: number) => Math.round(n * 100);

  // --- HIRE: best applicant in the existing pipeline -------------------------
  const applicants = (requisition.applicants ?? []).filter((a) => typeof a.match_score === "number");
  const bestApplicant = applicants.sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0))[0];
  const hireCoverage = bestApplicant ? pct(bestApplicant.match_score ?? 0) : 0;

  // --- MOVE: best-fit current employee (mobility) ----------------------------
  const moveCandidate = ranked[0];
  const moveCoverage = moveCandidate ? pct(moveCandidate.fit.score) : 0;

  // --- UPSKILL: employee with partial coverage + biggest verifiable gain -----
  // Deterministic projection: train their top missing required skills to target
  // and recompute the direct-coverage component (evidence stays claims).
  const upskillPool = ranked.filter((r) => r.fit.score >= 0.15 && r.fit.score < 0.7);
  let upskill = upskillPool[0];
  if (upskill) {
    const skills = (upskill.twin.verified_skills ?? []) as { name: string; proficiency: number; evidence_source: string; verification_rigor: "low" | "medium" | "high" }[];
    const have = new Set(skills.map((s) => s.name.toLowerCase()));
    const toTrain = requisition.required_skills.filter((r) => !have.has(r.skill.toLowerCase())).slice(0, 2);
    const projected = fitFor({
      id: upskill.twin.id,
      seniority_level: upskill.twin.seniority_level,
      verified_skills: [...skills, ...toTrain.map((t) => ({ name: t.skill, proficiency: t.target_proficiency, evidence_source: "training_projection", verification_rigor: "low" as const }))],
    });
    upskill = { twin: upskill.twin, fit: upskill.fit, projected, toTrain };
  }

  const hireOption = {
    id: "hire",
    label: "Hire externally",
    coverage_pct: hireCoverage,
    time_to_ready_days: ASSUMPTIONS.hire.time_to_ready_days,
    cost_usd: ASSUMPTIONS.hire.cost_usd,
    source: bestApplicant ? `Best applicant match in the current pipeline (${pct(bestApplicant.match_score ?? 0)}% engine score)` : "No scored applicants in the pipeline",
    constraints: [
      `${ASSUMPTIONS.hire.time_to_ready_days} days to ready — exceeds the ${DEADLINE_DAYS}-day window`,
      "Resume skills are claims until verified — a work sample and references are the evidence path",
      "Cost/time are demo assumptions, not a quote",
    ],
    note: ASSUMPTIONS.hire.note,
  };
  const moveOption = {
    id: "move",
    label: "Move internally",
    coverage_pct: moveCoverage,
    time_to_ready_days: ASSUMPTIONS.move.time_to_ready_days,
    cost_usd: ASSUMPTIONS.move.cost_usd,
    source: moveCandidate ? `${moveCandidate.twin.name} (${moveCandidate.twin.department}) — ${pct(moveCandidate.fit.score)}% engine fit today` : "No qualifying employee",
    constraints: [
      "Requires internal-mobility policy approval and the current manager's sign-off",
      "The vacated role needs a backfill decision",
      "Coverage is today's verified skills — any gap needs training",
    ],
    note: ASSUMPTIONS.move.note,
  };
  const upskillOption = {
    id: "upskill",
    label: "Upskill internally",
    coverage_pct: upskill ? pct(upskill.projected?.score ?? upskill.fit.score) : 0,
    time_to_ready_days: ASSUMPTIONS.upskill.time_to_ready_days,
    cost_usd: ASSUMPTIONS.upskill.cost_usd,
    source: upskill
      ? `${upskill.twin.name} (${upskill.twin.department}) — ${pct(upskill.fit.score)}% today → ${pct(upskill.projected?.score ?? upskill.fit.score)}% after training ${(upskill.toTrain ?? []).map((t) => t.skill).join(" + ") || "—"}`
      : "No partial-coverage employee found",
    constraints: [
      "Trained skills are claims (verification_rigor: low) until a work sample or review confirms them",
      `${DEADLINE_DAYS}-day window fits one focused training track, not a senior ramp`,
      "Cost/time are demo assumptions",
    ],
    note: ASSUMPTIONS.upskill.note,
  };
  const combinedCoverage = Math.min(100, hireCoverage + Math.round((1 - hireCoverage / 100) * (upskillOption.coverage_pct) / 100 * 100));
  const hybridOption = {
    id: "hybrid",
    label: "Hybrid (hire + upskill)",
    coverage_pct: combinedCoverage,
    time_to_ready_days: Math.max(ASSUMPTIONS.move.time_to_ready_days, Math.min(hireOption.time_to_ready_days, DEADLINE_DAYS)),
    cost_usd: ASSUMPTIONS.hire.cost_usd + ASSUMPTIONS.upskill.cost_usd,
    source: `${hireOption.source} · ${upskillOption.source}`,
    constraints: [
      "Depends on both tracks executing — hiring AND the training track",
      "External lead time still risks the window; internal track derisks it",
    ],
    note: "Combined coverage assumes both tracks succeed. Planning estimate under demo assumptions.",
  };

  return json({
    ok: true,
    computed_at: new Date().toISOString(),
    scenario: {
      req_id: requisition.id,
      req_title: requisition.title,
      department: requisition.department,
      deadline_days: DEADLINE_DAYS,
      target_date_note: `Target: a ready team in ${DEADLINE_DAYS} days (six weeks).`,
      demand: requisition.required_skills.map((s) => ({ skill: s.skill, target_proficiency: s.target_proficiency })),
      future_skills: (requisition.future_skills ?? []).map((s) => ({ skill: s.skill, target_proficiency: s.target_proficiency })),
      allocation_note: `Open requisition "${requisition.title}" (${requisition.department}) with ${applicants.length} scored applicant(s) in the pipeline.`,
    },
    options: [hireOption, moveOption, upskillOption, hybridOption],
    planning_note: "Coverage is computed deterministically from verified skills via the Skill Intelligence Graph. Cost/time are EXPLICIT demo assumptions — planning estimates, not guarantees, quotes, or promises of hiring quality.",
  });
}
