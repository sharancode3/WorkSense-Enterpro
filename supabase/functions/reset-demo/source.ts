import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  buildTwins,
  DEMO_ACCOUNTS,
  DEMO_ORG_ID,
  SECOND_ORG_ID,
  POLICIES,
  RECOMMENDATIONS,
  REQUISITIONS,
  SEED_JOURNEY,
  SKILLS,
} from "../_shared/seed-data.ts";
import { SEED_FITS } from "../_shared/generated-seed-fits.ts";
import { DEMO_FIXTURES } from "../_shared/generated-demo-fixtures.ts";
import { ASSESSMENT_SEEDS, PEOPLE_OPS_REQUISITION } from "../_shared/assessment.ts";
import { POLICY_ADDITIONS, TWIN_CONTEXT_OVERRIDES } from "../_shared/policy-seed.ts";
import { computeReviewIndex, reviewSourceHash } from "../_shared/workforce-review-index.ts";
import {
  buildPlanDefs,
  deriveStates,
  estimateReadiness,
  materialize,
  planHash,
} from "../_shared/onboarding-v2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

async function ensureDemoAuthUsers(supabase) {
  const created: string[] = [];
  const idByEmail: Record<string, string> = {};
  const { data: allUsers, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw new Error(`Failed to list auth users: ${listErr.message}`);
  const usersByEmail = new Map<string, string>();
  for (const ru of (allUsers?.users ?? []) as { email?: string; id?: string }[]) {
    if (ru.email && ru.id) usersByEmail.set(ru.email, ru.id);
  }

  for (const account of DEMO_ACCOUNTS) {
    const existingId = usersByEmail.get(account.email);
    if (existingId) {
      idByEmail[account.email] = existingId;
      continue;
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { name: account.name, is_demo: true },
    });
    if (error) throw new Error(`Failed to create demo user ${account.email}: ${error.message}`);
    created.push(account.email);
    idByEmail[account.email] = data.user.id;
  }
  return { created, idByEmail };
}

const rigorFor = (state: string) =>
  state === "reviewer_confirmed" ? "high" : state === "assessment_supported" ? "medium" : "low";
const sourceFor = (state: string) =>
  state === "reviewer_confirmed" ? "evidence_review" : state === "assessment_supported" ? "assessment" : state === "extracted" ? "resume_extraction" : "self_report";
const sourceTypeFor = (state: string) =>
  state === "reviewer_confirmed" ? "performance_review" : state === "assessment_supported" ? "assessment" : "resume_document";

const SKILL_NAME = new Map<string, string>(DEMO_FIXTURES.skills.map((s) => [s.id, s.skill]));

/**
 * Structural seed-twin shape accepted by `twinRow`. Fixtures arrive as literal
 * (read-only) unions, so the parameter is widened to the fields twinRow reads —
 * not a hiding cast, just an explicit structural contract.
 */
interface TwinSeedRow {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  job_title: string | null;
  manager_id: string | null;
  tenure_months: number;
  seniority_level: number;
  promotion_lag_months: number | null;
  attendance: unknown;
  delivery: unknown;
  assertions?: readonly {
    readonly skill_id: string;
    readonly claimed_proficiency: number;
    readonly review_state: string;
  }[];
  interview_rubrics?: unknown;
  performance_history?: unknown;
  signals?: unknown;
  audit_events?: unknown;
}

function twinRow(p: TwinSeedRow, orgId: string, authIds: Record<string, string>, roleOverride?: string) {
  const role = roleOverride ?? p.role;
  return {
    id: p.id,
    org_id: orgId,
    auth_user_id: authIds[p.email] ?? null,
    role,
    status: role === "candidate" ? "candidate" : "active",
    name: p.name,
    email: p.email,
    department: p.department,
    job_title: p.job_title,
    manager_id: p.manager_id,
    tenure_months: p.tenure_months,
    seniority_level: p.seniority_level,
    promotion_lag_months: p.promotion_lag_months,
    attendance: p.attendance,
    delivery: p.delivery,
    verified_skills: (p.assertions ?? [])
      .filter((a) => a.review_state === "reviewer_confirmed" || a.review_state === "assessment_supported")
      .map((a) => ({
        name: SKILL_NAME.get(a.skill_id),
        proficiency: a.claimed_proficiency,
        evidence_source: sourceFor(a.review_state),
        verification_rigor: rigorFor(a.review_state),
      })),
    interview_rubrics: p.interview_rubrics ?? [],
    performance_history: p.performance_history ?? [],
    signals: p.signals ?? [],
    computed_fits: (SEED_FITS[p.id] ?? []) as unknown[],
    audit_events: p.audit_events ?? [],
  };
}

async function tearDownDemo(supabase, authIds: Record<string, string>) {
  const orgs = [DEMO_ORG_ID, SECOND_ORG_ID];
  for (const orgId of orgs) {
    await supabase.from("action_tasks").delete().eq("org_id", orgId);
    await supabase.from("workflow_events").delete().eq("org_id", orgId);
    await supabase.from("admin_actions").delete().eq("org_id", orgId);
    await supabase.from("llm_cache").delete().eq("org_id", orgId);
    await supabase.from("workforce_observations").delete().eq("org_id", orgId);
    await supabase.from("performance_summaries").delete().eq("org_id", orgId);
    await supabase.from("workforce_review_cases").delete().eq("org_id", orgId);
    await supabase.from("candidate_sessions").delete().eq("org_id", orgId);
    await supabase.from("application_stage_events").delete().eq("org_id", orgId);
    await supabase.from("policy_escalations").delete().eq("org_id", orgId);
    await supabase.from("assessments").delete().eq("org_id", orgId);
    await supabase.from("onboarding_task_events").delete().eq("org_id", orgId);
    await supabase.from("onboarding_tasks").delete().eq("org_id", orgId);
    await supabase.from("onboarding_plans").delete().eq("org_id", orgId);
    await supabase.from("applications").delete().eq("org_id", orgId);
    await supabase.from("assessment_rubrics").delete().eq("org_id", orgId);
    await supabase.from("assessment_blueprints").delete().eq("org_id", orgId);
    await supabase.from("skill_assertions").delete().eq("org_id", orgId);
    await supabase.from("evidence_items").delete().eq("org_id", orgId);
    await supabase.from("policy_documents").delete().eq("org_id", orgId);
    await supabase.from("recommendations").delete().eq("org_id", orgId);
    await supabase.from("onboarding_journeys").delete().eq("org_id", orgId);
    await supabase.from("job_requisitions").delete().eq("org_id", orgId);
    await supabase.from("skill_graph").delete().eq("org_id", orgId);
    await supabase.from("model_jobs").delete().eq("org_id", orgId);
    await supabase.from("digital_twins").delete().eq("org_id", orgId);
  }
  const demoIds = Object.values(authIds);
  if (demoIds.length > 0) {
    await supabase.from("digital_twins").delete().in("auth_user_id", demoIds);
  }
  await supabase.from("organizations").delete().in("id", orgs);
}

async function reseedLegacy(supabase, authIds: Record<string, string>) {
  // Compact mode: the small golden seed (single org, 9 personas) — a quick demo.
  await supabase.from("recommendations").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("onboarding_task_events").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("onboarding_tasks").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("onboarding_plans").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("onboarding_journeys").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("applications").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("job_requisitions").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("skill_graph").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("model_jobs").delete().eq("org_id", DEMO_ORG_ID);
  const demoIds = Object.values(authIds);
  if (demoIds.length > 0) await supabase.from("digital_twins").delete().in("auth_user_id", demoIds);
  await supabase.from("digital_twins").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("organizations").delete().eq("id", DEMO_ORG_ID);

  const { error: orgErr } = await supabase.from("organizations").insert({ id: DEMO_ORG_ID, name: "WorkSense Demo Org", policies: POLICIES });
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  const { error: twinsErr } = await supabase.from("digital_twins").insert(buildTwins(authIds));
  if (twinsErr) throw new Error(`twins insert: ${twinsErr.message}`);
  // IT security service owner (explicit insert — kept out of TWINS so the
  // deterministic fixtures generator is unchanged).
  const { error: itErr } = await supabase.from("digital_twins").insert({
    id: ELENA_TWIN_ID,
    org_id: DEMO_ORG_ID,
    auth_user_id: authIds["elena@worksense.demo"] ?? null,
    role: "it_security",
    status: "active",
    name: "Elena Voss",
    email: "elena@worksense.demo",
    department: "IT Security",
    job_title: "IT Security Engineer",
    manager_id: DANA_TWIN_ID,
    tenure_months: 36,
    seniority_level: 3,
    promotion_lag_months: 12,
    attendance: { baseline: 0.2, recent: 0.2 },
    delivery: { missed: 1, total: 12 },
    verified_skills: [
      { name: "Identity & Access Management", proficiency: 4, evidence_source: "certification", verification_rigor: "high" },
      { name: "Incident Response", proficiency: 3, evidence_source: "project", verification_rigor: "medium" },
    ],
    interview_rubrics: [],
    performance_history: [
      { cycle: "2026-H1", rating: "Exceeds Expectations", goals_met: 92, feedback: [{ sentiment: "positive", text: "Cut SSO onboarding time by 40%." }], summary: "Cut SSO onboarding time by 40%." },
    ],
    signals: [],
    computed_fits: [],
    audit_events: [],
  });
  if (itErr) throw new Error(`IT twin insert: ${itErr.message}`);
  const { error: skillsErr } = await supabase.from("skill_graph").insert(SKILLS.map((s) => ({ ...s, org_id: DEMO_ORG_ID })));
  if (skillsErr) throw new Error(`skills insert: ${skillsErr.message}`);
  const { error: reqsErr } = await supabase.from("job_requisitions").insert(REQUISITIONS.map((r) => ({ ...r, org_id: DEMO_ORG_ID })));
  if (reqsErr) throw new Error(`reqs insert: ${reqsErr.message}`);
  const { error: journeyErr } = await supabase.from("onboarding_journeys").insert(SEED_JOURNEY);
  if (journeyErr) throw new Error(`journey insert: ${journeyErr.message}`);
  await seedPhase8Plan(supabase, DEMO_ORG_ID, SEED_FIXTURE_CLOCK);
  const { error: recsErr } = await supabase.from("recommendations").insert(RECOMMENDATIONS.map((r) => ({ ...r, org_id: DEMO_ORG_ID })));
  if (recsErr) throw new Error(`recs insert: ${recsErr.message}`);
}

// ---------------------------------------------------------------------------
// Phase 8 demo seed: Alex Chen's plan is APPROVED and active, with an access
// blocker reported by IT. Live flow: IT resolves + provisions (evidence) ->
// access_sso ready -> technical tasks become available -> employee completes
// with evidence -> readiness updates.
// ---------------------------------------------------------------------------
const ALEX_TWIN_ID = "22222222-2222-2222-2222-222222222203";
const ALEX_REQ_ID = "33333333-3333-3333-3333-333333333301";
const JORDAN_TWIN_ID = "22222222-2222-2222-2222-222222222202";
const DANA_TWIN_ID = "22222222-2222-2222-2222-222222222201";
const ELENA_TWIN_ID = "22222222-2222-2222-2222-222222222210";
// Phase 5 disposable candidate — isolated from shared demo candidates.
const DISPOSABLE_TWIN_ID = "22222222-2222-2222-2222-222222222299";
export const SEED_FIXTURE_CLOCK = "2026-09-15T09:00:00Z";

async function seedPhase8Plan(supabase, orgId: string, clock: string) {
  const { data: alex } = await supabase
    .from("digital_twins")
    .select("id, verified_skills, audit_events")
    .eq("id", ALEX_TWIN_ID)
    .maybeSingle();
  if (!alex) throw new Error("phase8 seed: Alex twin missing");

  const { data: req } = await supabase
    .from("job_requisitions")
    .select("id, title, required_skills, future_skills, seniority_level")
    .eq("id", ALEX_REQ_ID)
    .maybeSingle();
  if (!req) throw new Error("phase8 seed: Senior Backend Engineer requisition missing");

  const { data: polRows } = await supabase.from("policy_documents").select("doc_code, title").eq("org_id", orgId);
  const policyDocs = (polRows ?? []) as { doc_code: string; title: string }[];

  // Approved role relationship (application -> requisition), NOT a title guess.
  const { data: existingApp } = await supabase
    .from("applications")
    .select("id")
    .eq("org_id", orgId)
    .eq("candidate_twin_id", ALEX_TWIN_ID)
    .eq("requisition_id", ALEX_REQ_ID)
    .maybeSingle();
  let appId = existingApp?.id ?? null;
  if (!appId) {
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .insert({
        org_id: orgId,
        candidate_twin_id: ALEX_TWIN_ID,
        requisition_id: ALEX_REQ_ID,
        stage: "selected",
        application_code: "WS-ALEX-2026",
        applied_at: "2026-07-20T09:00:00Z",
      })
      .select("id")
      .single();
    if (appErr) throw new Error(`phase8 seed: application insert ${appErr.message}`);
    appId = app.id;
  }

  const defs = buildPlanDefs({
    role: req,
    verified_skills: (alex.verified_skills ?? []) as { name: string; proficiency: number }[],
    policy_docs: policyDocs,
  });
  const hash = planHash(defs);

  const done = ["security_training"];
  const blockedFacts = {
    access_sso: [
      { id: "blk-demo-access", note: "SSO enrollment blocked — laptop WS-8842 pending provisioning", reported_by: "elena@worksense.demo", at: clock, status: "open" as const },
    ],
  };
  const completion = {
    security_training: {
      actor_twin_id: ALEX_TWIN_ID,
      actor_name: "Alex Chen",
      at: clock,
      evidence: [{ kind: "note" as const, label: "Training completion reference", value: "TR-2026-SEC-ALEX" }],
      attempt_hash: "seed-security-training",
    },
  };
  const tasks = materialize(
    deriveStates(defs, { approved: true, startDate: clock, done, blockers: blockedFacts }),
    { completion, blockers: blockedFacts }
  );
  const readiness = estimateReadiness(defs, tasks, clock, clock);

  const startDate = "2026-07-21T09:00:00Z";
  const { data: planRow, error: planErr } = await supabase
    .from("onboarding_plans")
    .insert({
      org_id: orgId,
      twin_id: ALEX_TWIN_ID,
      application_id: appId,
      version: 1,
      plan_hash: hash,
      status: "approved",
      manager_approval: { by: "jordan@worksense.demo", by_twin_id: JORDAN_TWIN_ID, at: clock },
      hr_approval: { by: "dana@worksense.demo", by_twin_id: DANA_TWIN_ID, at: clock },
      start_date: startDate,
      generated_at: clock,
      readiness,
      carryover: [],
      audit_events: [
        { actor: "system", action: "plan_generated", note: `Plan v1 built from approved role "${req.title}" (deterministic seed).`, timestamp: clock },
        { actor: "system", action: "plan_activated", note: "Seeded with Manager + HR Executive approval (demo).", timestamp: clock },
      ],
    })
    .select("id")
    .single();
  if (planErr || !planRow) throw new Error(`phase8 seed: plan insert ${planErr?.message}`);

  const { error: taskErr } = await supabase.from("onboarding_tasks").insert(
    tasks.map((t) => ({
      org_id: orgId,
      plan_id: planRow.id,
      version: 1,
      task_code: t.task_code,
      title: t.title,
      task_type: t.task_type,
      owner_role: t.owner_role,
      required: t.required,
      non_waivable: t.non_waivable,
      depends_on: t.depends_on,
      duration_days: t.duration_days,
      due_date: t.due_date,
      topological_level: t.topological_level,
      why_evidence: t.why_evidence,
      evidence_requirements: t.evidence_requirements,
      state: t.state,
      completion_record: t.completion_record,
      blockers: t.blockers,
      waiver: t.waiver,
      adaptation: t.adaptation,
    }))
  );
  if (taskErr) throw new Error(`phase8 seed: tasks insert ${taskErr.message}`);
}

async function reseed(supabase, authIds: Record<string, string>) {
  await tearDownDemo(supabase, authIds);
  const fx = DEMO_FIXTURES;

  // 1) Organizations (demo + isolation org), with org jsonb.
  const { error: orgErr } = await supabase.from("organizations").insert([
    {
      id: DEMO_ORG_ID,
      name: "WorkSense Demo Org",
      policies: POLICIES,
      staffing_projects: fx.staffingProjects,
      learning_options: fx.learningOptions,
    },
    { id: SECOND_ORG_ID, name: fx.org2.org.name, policies: [], staffing_projects: [], learning_options: [] },
  ]);
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);

  // 2) Skill graph (canonical catalog with explicit ids + aliases).
  const demoSkills = fx.skills.map((s) => ({ ...s, org_id: DEMO_ORG_ID }));
  const org2Skills = fx.org2.skills.map((s) => ({ ...s, org_id: SECOND_ORG_ID }));
  const { error: skillsErr } = await supabase.from("skill_graph").insert([...demoSkills, ...org2Skills]);
  if (skillsErr) throw new Error(`skills insert: ${skillsErr.message}`);

  // 3) Digital twins: 60 employees + 24 candidates (demo org) + org-2 admin + 3 staff.
  const twins = [
    ...fx.employees.map((p) => twinRow(p, DEMO_ORG_ID, authIds)),
    ...fx.candidates.map((p) => twinRow(p, DEMO_ORG_ID, authIds)),
    {
      // Phase 5: a dedicated disposable candidate so acceptance test sessions
      // never touch the shared demo candidates (Priya stays pristine). Clearly
      // labeled; reset-demo restores it to "invited" on every reset.
      id: DISPOSABLE_TWIN_ID,
      org_id: DEMO_ORG_ID,
      auth_user_id: null,
      role: "candidate",
      status: "candidate",
      name: "Test Candidate (disposable)",
      email: "disposable@worksense.demo",
      department: "Candidate",
      job_title: "Senior Backend Engineer applicant",
      manager_id: null,
      tenure_months: 0,
      seniority_level: 3,
      promotion_lag_months: 0,
      attendance: { baseline: 0, recent: 0 },
      delivery: { missed: 0, total: 0 },
      verified_skills: [],
      interview_rubrics: [],
      performance_history: [],
      signals: [],
      computed_fits: [],
      audit_events: [{ actor: "system", action: "created", note: "Disposable test candidate (Phase 5 acceptance sandbox).", timestamp: fx.clock }],
    },
    {
      id: ELENA_TWIN_ID,
      org_id: DEMO_ORG_ID,
      auth_user_id: authIds["elena@worksense.demo"] ?? null,
      role: "it_security",
      status: "active",
      name: "Elena Voss",
      email: "elena@worksense.demo",
      department: "IT Security",
      job_title: "IT Security Engineer",
      manager_id: DANA_TWIN_ID,
      tenure_months: 36,
      seniority_level: 3,
      promotion_lag_months: 12,
      attendance: { baseline: 0.2, recent: 0.2 },
      delivery: { missed: 1, total: 12 },
      verified_skills: [
        { name: "Identity & Access Management", proficiency: 4, evidence_source: "certification", verification_rigor: "high" },
        { name: "Incident Response", proficiency: 3, evidence_source: "project", verification_rigor: "medium" },
      ],
      interview_rubrics: [],
      performance_history: [
        { cycle: "2026-H1", rating: "Exceeds Expectations", goals_met: 92, feedback: [{ sentiment: "positive", text: "Cut SSO onboarding time by 40%." }], summary: "Cut SSO onboarding time by 40%." },
      ],
      signals: [],
      computed_fits: [],
      audit_events: [],
    },
    {
      id: fx.org2.admin_twin.id,
      org_id: SECOND_ORG_ID,
      auth_user_id: authIds[fx.org2.admin_twin.email] ?? null,
      role: "hr_executive",
      status: "active",
      name: fx.org2.admin_twin.name,
      email: fx.org2.admin_twin.email,
      department: fx.org2.admin_twin.department,
      job_title: fx.org2.admin_twin.job_title,
      manager_id: null,
      tenure_months: 48,
      seniority_level: 5,
      promotion_lag_months: 12,
      attendance: { baseline: 0.2, recent: 0.2 },
      delivery: { missed: 0, total: 8 },
      verified_skills: [],
      interview_rubrics: [],
      performance_history: [],
      signals: [],
      computed_fits: [],
      audit_events: [],
    },
    ...fx.org2.employees.map((p) => twinRow(p, SECOND_ORG_ID, authIds)),
  ];
  const { error: twinsErr } = await supabase.from("digital_twins").insert(twins);
  if (twinsErr) throw new Error(`twins insert: ${twinsErr.message}`);

  // 4) Requisitions (engine-consistent applicants).
  const { error: reqsErr } = await supabase.from("job_requisitions").insert(
    fx.requisitions.map((r) => ({ ...r, org_id: DEMO_ORG_ID }))
  );
  if (reqsErr) throw new Error(`reqs insert: ${reqsErr.message}`);
  const { error: org2ReqErr } = await supabase
    .from("job_requisitions")
    .insert({ ...fx.org2.requisition, org_id: SECOND_ORG_ID });
  if (org2ReqErr) throw new Error(`org2 req insert: ${org2ReqErr.message}`);
  // People Operations Partner requisition hosts the Phase 6 People Ops blueprint.
  const { error: poReqErr } = await supabase
    .from("job_requisitions")
    .insert({ ...PEOPLE_OPS_REQUISITION, org_id: DEMO_ORG_ID });
  if (poReqErr) throw new Error(`people-ops req insert: ${poReqErr.message}`);

  // 4b) Assessment blueprints + rubrics (deterministic canonical seeds).
  const { error: bpErr } = await supabase.from("assessment_blueprints").insert(
    ASSESSMENT_SEEDS.map((s) => ({
      id: s.id,
      org_id: DEMO_ORG_ID,
      requisition_id: s.requisition_id,
      competency: s.competency,
      kind: s.kind,
      version: s.version,
      artifact_spec: { title: s.title, kind: s.kind, instructions: s.instructions, time_policy: s.time_policy, questions: s.questions },
      test_cases: s.test_cases,
      prompt_adaptation_allowed: s.prompt_adaptation_allowed,
      created_by: null,
    }))
  );
  if (bpErr) throw new Error(`blueprints insert: ${bpErr.message}`);
  const { error: rbErr } = await supabase.from("assessment_rubrics").insert(
    ASSESSMENT_SEEDS.flatMap((s) =>
      s.rubrics.map((r) => ({
        id: r.id,
        org_id: DEMO_ORG_ID,
        blueprint_id: s.id,
        competency: r.competency,
        version: r.version,
        observable_behavior: r.observable_behavior,
        evidence_requirements: r.evidence_requirements,
        anchors: r.anchors,
        critical_mistakes: r.critical_mistakes,
        insufficient_evidence_conditions: r.insufficient_evidence_conditions,
        skill_mapping: r.skill_mapping,
      }))
    )
  );
  if (rbErr) throw new Error(`rubrics insert: ${rbErr.message}`);

  // 5) Policy documents (12 versioned).
  const { error: polErr } = await supabase.from("policy_documents").insert(
    fx.policies.map((p) => ({ ...p, org_id: DEMO_ORG_ID, sections: p.sections }))
  );
  if (polErr) throw new Error(`policies insert: ${polErr.message}`);

  // 5b) Phase 7 policy additions: versioned Leave v2 superseding fixture v1,
  // an expired Catering policy, and an EU-only remote exception.
  const { data: lveV1 } = await supabase
    .from("policy_documents")
    .select("id")
    .eq("org_id", DEMO_ORG_ID)
    .eq("doc_code", "POL-LVE")
    .eq("version", 1)
    .maybeSingle();
  if (lveV1) {
    const { error: lveToErr } = await supabase
      .from("policy_documents")
      .update({ effective_to: "2025-12-31" })
      .eq("id", lveV1.id);
    if (lveToErr) throw new Error(`POL-LVE v1 window update: ${lveToErr.message}`);
  }
  const additions = POLICY_ADDITIONS.map((p) => ({
    ...p,
    org_id: DEMO_ORG_ID,
    supersedes_doc_id: p.doc_code === "POL-LVE" ? lveV1?.id ?? null : null,
    sections: p.sections,
  }));
  const { error: polAddErr } = await supabase.from("policy_documents").insert(additions);
  if (polAddErr) throw new Error(`policy additions insert: ${polAddErr.message}`);

  // 5c) Employee context overrides (location / worker type) for applicability.
  for (const [email, ctx] of Object.entries(TWIN_CONTEXT_OVERRIDES)) {
    await supabase.from("digital_twins").update(ctx).eq("org_id", DEMO_ORG_ID).eq("email", email);
  }

  // 6) Onboarding journeys (legacy mid-onboarding persona + 4 fixture states).
  const journeyStatus = (tasks: readonly { status?: string }[]) =>
    tasks.length > 0 && tasks.every((t) => t.status === "done")
      ? "completed"
      : tasks.some((t) => t.status === "done")
        ? "in_progress"
        : "pending";
  const { error: journeyErr } = await supabase.from("onboarding_journeys").insert([
    SEED_JOURNEY,
    ...fx.journeys.map((j) => ({
      id: j.id,
      org_id: DEMO_ORG_ID,
      twin_id: j.twin_id,
      tasks: j.tasks,
      status: journeyStatus(j.tasks),
      plan: {},
      audit_events: [{ actor: "system", action: "created", note: "Onboarding journey seeded (fixture).", timestamp: fx.clock }],
    })),
  ]);
  if (journeyErr) throw new Error(`journey insert: ${journeyErr.message}`);

  // 7) Recommendations (golden seed only — their claims were validated at baseline).
  const { error: recsErr } = await supabase.from("recommendations").insert(
    RECOMMENDATIONS.map((r) => ({ ...r, org_id: DEMO_ORG_ID }))
  );
  if (recsErr) throw new Error(`recs insert: ${recsErr.message}`);

  // 7b) Dispatched upskilling recommendation + action tasks (dispatch workflow demo).
  //     Approved recs whose tasks exist are in execution_pending — dispatch is
  //     only "done" when the task rows exist (Phase 11 transaction rule).
  const s05 = fx.scenarios.find((s) => s.id === "s05");
  const upskillRec = {
    id: "44444444-4444-4444-4444-444444444404",
    org_id: DEMO_ORG_ID,
    twin_id: s05?.twin_id ?? null,
    category: "upskilling",
    urgency: "low",
    status: "execution_pending",
    version: 2,
    evidence_ledger: [
      { source: "SKILL_GRAPH", fact: "Future fit exceeds current fit for the Data Analyst role; the dbt/statistics ladder is the shortest path." },
      { source: "POLICY", fact: "Learning & Development policy (POL-LND) covers role-relevant courses up to 2,500/year." },
    ],
    proposed_action: {
      title: "Approve the upskilling route (no external hire)",
      description: "Route the analyst through the L&D program instead of opening a requisition.",
      steps: [
        { order: 1, action: "Enroll in Advanced SQL & dbt." },
        { order: 2, action: "Pair with the Data team on the dbt migration project." },
        { order: 3, action: "Re-run the future-fit match after the course." },
      ],
    },
    required_signoff_role: "manager",
    reviewer_rationale: { last: "Manager approved: cheaper and faster than hiring.", by: "jordan@worksense.demo", at: fx.clock },
    audit_events: [{ actor: "system", action: "approved", note: "Seeded dispatched recommendation (fixture).", timestamp: fx.clock }],
  };
  const { error: upRecErr } = await supabase.from("recommendations").insert(upskillRec);
  if (upRecErr) throw new Error(`upskill rec insert: ${upRecErr.message}`);
  if (upskillRec.twin_id) {
    const { error: tasksErr } = await supabase.from("action_tasks").insert([
      {
        org_id: DEMO_ORG_ID,
        recommendation_id: upskillRec.id,
        owner_twin_id: upskillRec.twin_id,
        owner_role: "employee",
        task_code: "targeted_learning",
        title: "Enroll in Advanced SQL & dbt (L&D)",
        status: "open",
        due_at: new Date(new Date(fx.clock).getTime() + 14 * 86400000).toISOString(),
        instructions: "Enroll in the Advanced SQL & dbt course and attach the completion reference.",
        resource_link: "https://learning.worksense.demo/lnd",
        required_evidence: ["completion_reference"],
        outcome_measure: { metric: "learning_completed", target: true },
        created_by_request_id: "seed-upskill-dispatch",
        outcome: {},
      },
      {
        org_id: DEMO_ORG_ID,
        recommendation_id: upskillRec.id,
        owner_twin_id: upskillRec.twin_id,
        owner_role: "employee",
        task_code: "pair_data",
        title: "Pair with the Data team on the dbt migration",
        status: "in_progress",
        due_at: new Date(new Date(fx.clock).getTime() + 30 * 86400000).toISOString(),
        instructions: "Pair with the Data team on the dbt migration; record the delivered work.",
        required_evidence: ["work_reference"],
        outcome_measure: { metric: "migration_paired", target: true },
        created_by_request_id: "seed-upskill-dispatch",
        outcome: {},
      },
    ]);
    if (tasksErr) throw new Error(`action_tasks insert: ${tasksErr.message}`);
  }

  // 8) Evidence items + skill assertions (normalized source of truth).
  const toEvidence = (p: { id: string; assertions?: readonly { readonly skill_id: string; readonly quote: string; readonly review_state: string }[] }, orgId: string) =>
    (p.assertions ?? []).map((a) => ({
      org_id: orgId,
      twin_id: p.id,
      source_type: sourceTypeFor(a.review_state),
      source_id: `${a.review_state}:${a.skill_id}`,
      captured_at: fx.clock,
      quote: a.quote,
      review_state: a.review_state,
      metadata: { skill_id: a.skill_id },
    }));
  const demoEvidence = [...fx.employees, ...fx.candidates].flatMap((p) => toEvidence(p, DEMO_ORG_ID));
  const org2Evidence = fx.org2.employees.flatMap((p) => toEvidence(p, SECOND_ORG_ID));
  const { data: evRows, error: evErr } = await supabase
    .from("evidence_items")
    .insert([...demoEvidence, ...org2Evidence])
    .select("id, org_id, twin_id, metadata");
  if (evErr) throw new Error(`evidence insert: ${evErr.message}`);
  const evMap = new Map(
    (evRows ?? []).map((e) => [`${e.org_id}|${e.twin_id}|${String((e.metadata as { skill_id?: string })?.skill_id ?? "")}`, e.id])
  );
  const toAssertion = (p: { id: string; assertions?: readonly { readonly skill_id: string; readonly claimed_proficiency: number; readonly proficiency_tier: string; readonly review_state: string }[] }, orgId: string) =>
    (p.assertions ?? []).map((a) => ({
      org_id: orgId,
      twin_id: p.id,
      skill_id: a.skill_id,
      claimed_proficiency: a.claimed_proficiency,
      proficiency_tier: a.proficiency_tier,
      review_state: a.review_state,
      evidence_ids: [evMap.get(`${orgId}|${p.id}|${a.skill_id}`)].filter(Boolean),
    }));
  const demoAssertions = [...fx.employees, ...fx.candidates].flatMap((p) => toAssertion(p, DEMO_ORG_ID));
  const org2Assertions = fx.org2.employees.flatMap((p) => toAssertion(p, SECOND_ORG_ID));
  const { error: assertErr } = await supabase.from("skill_assertions").insert([...demoAssertions, ...org2Assertions]);
  if (assertErr) throw new Error(`assertions insert: ${assertErr.message}`);

  // Phase 12: one honest "insufficient evidence" case. A Data-team employee
  // self-reports GTM Strategy — a Senior Product Manager future skill with no
  // verified path from their skills — but nothing is verified yet. Keeps the
  // dashboard heatmap's insufficient_evidence bucket real: claimed-but-
  // unverified skills must not look like "ready" or "missing".
  const claimedGtmSkillId = fx.skills.find((s) => s.skill === "GTM Strategy")?.id;
  const claimedGtmTwinId = fx.employees.find((e) => e.department === "Data")?.id;
  if (claimedGtmSkillId && claimedGtmTwinId) {
    const { error: claimErr } = await supabase.from("skill_assertions").insert({
      org_id: DEMO_ORG_ID,
      twin_id: claimedGtmTwinId,
      skill_id: claimedGtmSkillId,
      claimed_proficiency: 2,
      proficiency_tier: "FOUNDATIONAL",
      review_state: "claimed",
      evidence_ids: [],
    });
    if (claimErr) throw new Error(`claimed future skill insert: ${claimErr.message}`);
  }

  // 9) Applications (candidate -> requisition, staged).
  const apps = fx.requisitions.flatMap((r) =>
    (r.applicants ?? []).map((ap) => ({
      org_id: DEMO_ORG_ID,
      candidate_twin_id: ap.twin_id,
      requisition_id: r.id,
      stage: ap.stage,
      application_code: ap.application_code,
      applied_at: ap.applied_at,
    }))
  );
  if (apps.length > 0) {
    const { error: appsErr } = await supabase.from("applications").insert(apps);
    if (appsErr) throw new Error(`applications insert: ${appsErr.message}`);
  }

  // 9a) Phase 8: Alex's approved role application + adaptive onboarding plan
  // (access blocker reported by IT, provisioning/learning/verification tasks).
  await seedPhase8Plan(supabase, DEMO_ORG_ID, fx.clock);

  // 9b) Candidate sessions (Phase 6 + Phase 5): Priya gets one session per
  // format — work_sample (payments service design), interview (production
  // incident interview), knowledge_assessment (core backend knowledge) — each on
  // its own genuinely-different blueprint. The disposable candidate mirrors the
  // three sessions for isolated acceptance runs.
  const priyaId = "22222222-2222-2222-2222-222222222205";
  const workBlueprint = ASSESSMENT_SEEDS.find((s) => s.id === "66666666-6666-6666-6666-666666666601");
  const interviewBlueprint = ASSESSMENT_SEEDS.find((s) => s.id === "66666666-6666-6666-6666-666666666604");
  const knowledgeBlueprint = ASSESSMENT_SEEDS.find((s) => s.id === "66666666-6666-6666-6666-666666666605");
  if (!workBlueprint || !interviewBlueprint || !knowledgeBlueprint) {
    throw new Error("sessions seed: a Phase 5 blueprint is missing from ASSESSMENT_SEEDS");
  }
  const { data: priyaApp } = await supabase
    .from("applications")
    .select("id")
    .eq("candidate_twin_id", priyaId)
    .eq("requisition_id", workBlueprint.requisition_id)
    .maybeSingle();
  if (!priyaApp) throw new Error("sessions seed: Priya application missing");

  // Disposable candidate application (isolated acceptance sandbox).
  const { data: disposableApp, error: discAppErr } = await supabase
    .from("applications")
    .insert({
      org_id: DEMO_ORG_ID,
      candidate_twin_id: DISPOSABLE_TWIN_ID,
      requisition_id: workBlueprint.requisition_id,
      stage: "screening",
      application_code: "WS-DISPOSABLE-2026",
      applied_at: "2026-09-10T09:00:00Z",
    })
    .select("id")
    .single();
  if (discAppErr) throw new Error(`disposable application insert: ${discAppErr.message}`);
  const { data: backendReq } = await supabase
    .from("job_requisitions")
    .select("applicants")
    .eq("id", workBlueprint.requisition_id)
    .eq("org_id", DEMO_ORG_ID)
    .maybeSingle();
  if (backendReq) {
    const applicants = backendReq.applicants ?? [];
    if (!applicants.some((a: { application_code?: string }) => a.application_code === "WS-DISPOSABLE-2026")) {
      await supabase
        .from("job_requisitions")
        .update({
          applicants: [
            ...applicants,
            { twin_id: DISPOSABLE_TWIN_ID, stage: "screening", application_code: "WS-DISPOSABLE-2026", applied_at: "2026-09-10T09:00:00Z", match_score: 0.5 },
          ],
        })
        .eq("id", workBlueprint.requisition_id);
    }
  }

  const expiresAt = new Date(new Date(fx.clock).getTime() + 30 * 86400000).toISOString();
  const sessionRow = (
    id: string,
    appId: string,
    twinId: string,
    blueprint: typeof workBlueprint,
    sessionType: string,
    token: string
  ) => ({
    id,
    org_id: DEMO_ORG_ID,
    application_id: appId,
    twin_id: twinId,
    blueprint_id: blueprint.id,
    rubric_id: null,
    session_type: sessionType,
    invitation_token: token,
    status: "invited",
    expires_at: expiresAt,
    time_policy: blueprint.time_policy,
    accommodation: {},
    answers: {},
    drafts: {},
    follow_ups: [],
  });
  const { error: sessErr } = await supabase.from("candidate_sessions").insert([
    sessionRow("77777777-7777-7777-7777-777777777701", priyaApp.id, priyaId, workBlueprint, "work_sample", "ws-demo-priya-work-2026"),
    sessionRow("77777777-7777-7777-7777-777777777702", priyaApp.id, priyaId, interviewBlueprint, "interview", "ws-demo-priya-interview-2026"),
    sessionRow("77777777-7777-7777-7777-777777777703", priyaApp.id, priyaId, knowledgeBlueprint, "knowledge_assessment", "ws-demo-priya-knowledge-2026"),
    sessionRow("77777777-7777-7777-7777-777777777704", disposableApp.id, DISPOSABLE_TWIN_ID, workBlueprint, "work_sample", "ws-demo-disc-work-2026"),
    sessionRow("77777777-7777-7777-7777-777777777705", disposableApp.id, DISPOSABLE_TWIN_ID, interviewBlueprint, "interview", "ws-demo-disc-interview-2026"),
    sessionRow("77777777-7777-7777-7777-777777777706", disposableApp.id, DISPOSABLE_TWIN_ID, knowledgeBlueprint, "knowledge_assessment", "ws-demo-disc-knowledge-2026"),
  ]);
  if (sessErr) throw new Error(`sessions insert: ${sessErr.message}`);

  // 10) Workforce observations (12 months, explicit missingness).
  const monthEnd = (period: string) => {
    const [y, m] = period.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${period}-${String(last).padStart(2, "0")}`;
  };
  const obs = fx.observations.map((o) => ({
    org_id: DEMO_ORG_ID,
    twin_id: o.twin_id,
    metric: o.metric,
    period_start: `${o.period}-01`,
    period_end: monthEnd(o.period),
    value: o.value,
    missing: o.missing,
  }));
  const { error: obsErr } = await supabase.from("workforce_observations").insert(obs);
  if (obsErr) throw new Error(`observations insert: ${obsErr.message}`);

  // 10b) Workforce Review Cases (deterministic index, seeded from the same
  // engine used by the workforce-review-index function — consistent by
  // construction). The index is decision support, never a probability.
  const cases = fx.employees
    .filter((p) => p.role === "employee" || p.role === "manager")
    .map((p) => {
      const pObs = fx.observations
        .filter((o) => o.twin_id === p.id)
        .map((o) => ({ metric: o.metric, period: o.period, value: o.value, missing: o.missing }));
      const input = {
        twin_id: p.id,
        promotion_lag_months: p.promotion_lag_months ?? 0,
        attendance: p.attendance ?? {},
        delivery: p.delivery ?? {},
        observations: pObs,
        seeks_growth: p.seeks_growth === true,
      };
      const r = computeReviewIndex(input);
      const firstPeriod = pObs.length > 0 ? pObs[0].period : "2025-10";
      const lastPeriod = pObs.length > 0 ? pObs[pObs.length - 1].period : "2026-09";
      return {
        org_id: DEMO_ORG_ID,
        twin_id: p.id,
        period_start: `${firstPeriod}-01`,
        period_end: `${lastPeriod}-28`,
        index: r.index,
        priority: r.priority,
        factors: r.factors,
        trend: r.trend,
        data_completeness: r.data_completeness,
        missing_data: r.missing_data,
        fact_finding: r.recommended_fact_finding,
        seeking_growth: r.seeking_growth,
        sensitivity: r.sensitivity,
        limitations: r.limitations,
        priority_gate: r.priority_gate,
        source_version_hash: reviewSourceHash(input),
        computed_at: fx.clock,
      };
    });
  if (cases.length > 0) {
    const { error: casesErr } = await supabase.from("workforce_review_cases").insert(cases);
    if (casesErr) throw new Error(`review cases insert: ${casesErr.message}`);
  }

  // 11) Assessments (from preserved interview rubrics).
  const assessments = fx.candidates.flatMap((c) =>
    (c.interview_rubrics ?? []).map((rb) => ({
      org_id: DEMO_ORG_ID,
      twin_id: c.id,
      type: "interview",
      result: rb,
    }))
  );
  if (assessments.length > 0) {
    const { error: assErr } = await supabase.from("assessments").insert(assessments);
    if (assErr) throw new Error(`assessments insert: ${assErr.message}`);
  }

  // 12) Recruitment workspace: deterministic per-requisition rubrics + weighted
  // selection criteria. Rubrics are seeded offline so the demo "Interview kit"
  // flow succeeds deterministically (cached per role) instead of depending on a
  // live model call; criteria drive the Compare workspace.
  await seedRecruitmentWorkspace(supabase, DEMO_ORG_ID, fx.clock);
}

// ---------------------------------------------------------------------------
// Phase 4: recruitment workspace seed — deterministic rubrics + criteria.
// Offline, high-quality rubrics make interview-kit generation deterministic in
// the demo (no live model dependency); weighted criteria power the Compare tab.
// ---------------------------------------------------------------------------
interface SeedReqRow {
  id: string;
  title: string;
  required_skills: { skill: string; target_proficiency: number }[];
  future_skills: { skill: string; target_proficiency: number }[];
}

function demoRubricFor(competency: string, title: string): { competency: string; question: string; follow_up_probes: string[]; rubric: Record<string, string> } {
  const c = competency;
  const probe = c === "Collaboration"
    ? `Tell me about a cross-functional disagreement you navigated while delivering against ${title}. What was your role in reaching the outcome?`
    : `Walk me through a time you applied ${c} under a real constraint for a ${title} outcome. What did you choose, why, and what went wrong?`;
  return {
    competency: c,
    question: probe,
    follow_up_probes: ["What would you change with hindsight, and how do you know it would have helped?", "How did you validate the result with evidence rather than opinion?"],
    rubric: {
      tier_1: `Ignores ${c} constraints in the ${title} context — regresses the team baseline with no defensible reasoning.`,
      tier_2: `Applies ${c} only when prompted; cannot explain trade-offs or own the outcome independently.`,
      tier_3: `Consistently applies ${c} at the ${title} baseline and defends key decisions with concrete, verifiable examples.`,
      tier_4: `Drives ${c} improvements across the team's scope, coaches peers, and catches regressions early with evidence.`,
      tier_5: `Sets the ${c} standard for the organization — designs approaches others adopt and audits outcomes rigorously.`,
    },
  };
}

async function seedRecruitmentWorkspace(supabase, orgId: string, clock: string) {
  const { data: rows } = await supabase
    .from("job_requisitions")
    .select("id, title, required_skills, future_skills, requisition_criteria, rubrics, audit_events")
    .eq("org_id", orgId);

  for (const req of (rows ?? []) as (SeedReqRow & { requisition_criteria?: unknown[]; rubrics?: unknown[]; audit_events?: unknown[] })[]) {
    const required = req.required_skills ?? [];
    const future = req.future_skills ?? [];

    const rubrics = [...required.map((s) => s.skill), "Collaboration"].map((comp) => demoRubricFor(comp, req.title));

    const nReq = Math.max(required.length, 1);
    const criteria = [
      ...required.map((s, i) => ({
        skill: s.skill,
        target_proficiency: s.target_proficiency,
        requirement: "required" as const,
        weight: Number((1 / nReq).toFixed(2)),
        evidence_expectation: `Source artifact proving ${s.skill} at proficiency ${s.target_proficiency}: prior-role project output, work sample, or verified reference.`,
      })),
      ...future.map((s) => ({
        skill: s.skill,
        target_proficiency: s.target_proficiency,
        requirement: "preferred" as const,
        weight: 0.4,
        evidence_expectation: `Evidence of trajectory toward ${s.skill} (learning artifact, stretch work, or certification in progress).`,
      })),
    ];

    const criteriaChanged =
      JSON.stringify(req.requisition_criteria ?? []) !== JSON.stringify(criteria) ||
      (req.rubrics ?? []).length === 0;

    if (!criteriaChanged) continue;
    const audit = [...(req.audit_events ?? [])];
    if ((req.rubrics ?? []).length === 0) {
      audit.push({ actor: "seed", action: "rubrics_seeded", note: "Deterministic interview rubrics seeded per role.", timestamp: clock });
    }
    if (JSON.stringify(req.requisition_criteria ?? []) !== JSON.stringify(criteria)) {
      audit.push({ actor: "seed", action: "criteria_seeded", note: "Weighted selection criteria established for the Compare workspace.", timestamp: clock });
    }
    await supabase
      .from("job_requisitions")
      .update({ rubrics, requisition_criteria: criteria, audit_events: audit })
      .eq("id", req.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Authorize: the database is considered initialized once a linked HR
  // Executive twin exists. Until then (fresh Cloud), bootstrap is allowed.
  const { count: hrCount, error: hrErr } = await supabase
    .from("digital_twins")
    .select("id", { count: "exact", head: true })
    .eq("role", "hr_executive")
    .not("auth_user_id", "is", null);
  if (hrErr) throw hrErr;
  const isInitialized = (hrCount ?? 0) > 0;

  if (isInitialized) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const uid = userData?.user?.id;
    if (!uid) return jsonResponse({ error: "UNAUTHENTICATED" }, 401);

    const { data: twin } = await supabase
      .from("digital_twins")
      .select("role")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (twin?.role !== "hr_executive") {
      return jsonResponse({ error: "FORBIDDEN", message: "Only HR Executives may reset demo data." }, 403);
    }
  }

  try {
    let body: { compact?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      /* empty */
    }
    const { created, idByEmail } = await ensureDemoAuthUsers(supabase);
    if (body.compact === true) {
      await reseedLegacy(supabase, idByEmail);
      return jsonResponse({
        ok: true,
        compact: true,
        created_users: created,
        seeded: { organizations: 1, digital_twins: buildTwins({}).length, skill_graph: SKILLS.length, job_requisitions: REQUISITIONS.length, onboarding_journeys: 1, recommendations: RECOMMENDATIONS.length },
      });
    }
    await reseed(supabase, idByEmail);
    const fx = DEMO_FIXTURES;
    return jsonResponse({
      ok: true,
      created_users: created,
      seeded: {
        organizations: 2,
        digital_twins: fx.employees.length + fx.candidates.length + 2 + fx.org2.employees.length,
        skill_graph: fx.skills.length + fx.org2.skills.length,
        job_requisitions: fx.requisitions.length + 2,
        policy_documents: fx.policies.length + POLICY_ADDITIONS.length,
        onboarding_journeys: 1 + fx.journeys.length,
        recommendations: RECOMMENDATIONS.length,
        assessment_blueprints: ASSESSMENT_SEEDS.length,
        assessment_rubrics: ASSESSMENT_SEEDS.reduce((n, s) => n + s.rubrics.length, 0),
        candidate_sessions: 6,
        evidence_items: fx.employees.reduce((n, e) => n + (e.assertions ?? []).length, 0) + fx.candidates.reduce((n, c) => n + (c.assertions ?? []).length, 0) + fx.org2.employees.reduce((n, e) => n + (e.assertions ?? []).length, 0),
        skill_assertions: fx.employees.reduce((n, e) => n + (e.assertions ?? []).length, 0) + fx.candidates.reduce((n, c) => n + (c.assertions ?? []).length, 0) + fx.org2.employees.reduce((n, e) => n + (e.assertions ?? []).length, 0),
        applications: fx.requisitions.reduce((n, r) => n + (r.applicants ?? []).length, 0) + 1,
        workforce_observations: fx.observations.length,
        workforce_review_cases: fx.employees.filter((p) => p.role === "employee" || p.role === "manager").length,
      },
    });
  } catch (err) {
    console.error("reset-demo failed:", err);
    return jsonResponse({ error: "INTERNAL", message: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
