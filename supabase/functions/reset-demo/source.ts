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
  const usersByEmail = new Map((allUsers?.users ?? []).map((u) => [u.email, u.id]));

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

const SKILL_NAME = new Map(DEMO_FIXTURES.skills.map((s) => [s.id, s.skill]));

function twinRow(p: (typeof DEMO_FIXTURES.employees)[number], orgId: string, authIds: Record<string, string>, roleOverride?: string) {
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
    await supabase.from("workforce_observations").delete().eq("org_id", orgId);
    await supabase.from("candidate_sessions").delete().eq("org_id", orgId);
    await supabase.from("application_stage_events").delete().eq("org_id", orgId);
    await supabase.from("assessments").delete().eq("org_id", orgId);
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
  await supabase.from("onboarding_journeys").delete().eq("org_id", DEMO_ORG_ID);
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
  const { error: skillsErr } = await supabase.from("skill_graph").insert(SKILLS.map((s) => ({ ...s, org_id: DEMO_ORG_ID })));
  if (skillsErr) throw new Error(`skills insert: ${skillsErr.message}`);
  const { error: reqsErr } = await supabase.from("job_requisitions").insert(REQUISITIONS.map((r) => ({ ...r, org_id: DEMO_ORG_ID })));
  if (reqsErr) throw new Error(`reqs insert: ${reqsErr.message}`);
  const { error: journeyErr } = await supabase.from("onboarding_journeys").insert(SEED_JOURNEY);
  if (journeyErr) throw new Error(`journey insert: ${journeyErr.message}`);
  const { error: recsErr } = await supabase.from("recommendations").insert(RECOMMENDATIONS.map((r) => ({ ...r, org_id: DEMO_ORG_ID })));
  if (recsErr) throw new Error(`recs insert: ${recsErr.message}`);
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

  // 6) Onboarding journeys (legacy mid-onboarding persona + 4 fixture states).
  const journeyStatus = (tasks: { status?: string }[]) =>
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
  const s05 = fx.scenarios.find((s) => s.id === "s05");
  const upskillRec = {
    id: "44444444-4444-4444-4444-444444444404",
    org_id: DEMO_ORG_ID,
    twin_id: s05?.twin_id ?? null,
    category: "upskilling",
    urgency: "low",
    status: "approved",
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
        title: "Enroll in Advanced SQL & dbt (L&D)",
        status: "open",
        due_at: new Date(new Date(fx.clock).getTime() + 14 * 86400000).toISOString(),
        outcome: {},
      },
      {
        org_id: DEMO_ORG_ID,
        recommendation_id: upskillRec.id,
        owner_twin_id: upskillRec.twin_id,
        title: "Pair with the Data team on the dbt migration",
        status: "in_progress",
        due_at: new Date(new Date(fx.clock).getTime() + 30 * 86400000).toISOString(),
        outcome: {},
      },
    ]);
    if (tasksErr) throw new Error(`action_tasks insert: ${tasksErr.message}`);
  }

  // 8) Evidence items + skill assertions (normalized source of truth).
  const toEvidence = (p: { id: string; assertions?: { skill_id: string; quote: string; review_state: string }[] }, orgId: string) =>
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
  const toAssertion = (p: { id: string; assertions?: { skill_id: string; claimed_proficiency: number; proficiency_tier: string; review_state: string }[] }, orgId: string) =>
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

  // 9b) Candidate sessions (Phase 6): Priya has an open work-sample and an
  // interview session on the Senior Backend Engineer blueprint — this is the
  // demo path the completion gate exercises end-to-end.
  const priyaId = "22222222-2222-2222-2222-222222222205";
  const backendBlueprint = ASSESSMENT_SEEDS.find((s) => s.id === "66666666-6666-6666-6666-666666666601");
  const { data: priyaApp } = await supabase
    .from("applications")
    .select("id")
    .eq("candidate_twin_id", priyaId)
    .eq("requisition_id", backendBlueprint?.requisition_id ?? "")
    .maybeSingle();
  if (!backendBlueprint || !priyaApp) throw new Error("sessions seed: backend blueprint or Priya application missing");
  const expiresAt = new Date(new Date(fx.clock).getTime() + 30 * 86400000).toISOString();
  const { error: sessErr } = await supabase.from("candidate_sessions").insert([
    {
      id: "77777777-7777-7777-7777-777777777701",
      org_id: DEMO_ORG_ID,
      application_id: priyaApp.id,
      twin_id: priyaId,
      blueprint_id: backendBlueprint.id,
      rubric_id: null,
      session_type: "work_sample",
      invitation_token: "ws-demo-priya-work-2026",
      status: "invited",
      expires_at: expiresAt,
      time_policy: backendBlueprint.time_policy,
      accommodation: {},
      answers: {},
      drafts: {},
      follow_ups: [],
    },
    {
      id: "77777777-7777-7777-7777-777777777702",
      org_id: DEMO_ORG_ID,
      application_id: priyaApp.id,
      twin_id: priyaId,
      blueprint_id: backendBlueprint.id,
      rubric_id: null,
      session_type: "interview",
      invitation_token: "ws-demo-priya-interview-2026",
      status: "invited",
      expires_at: expiresAt,
      time_policy: backendBlueprint.time_policy,
      accommodation: {},
      answers: {},
      drafts: {},
      follow_ups: [],
    },
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
        digital_twins: fx.employees.length + fx.candidates.length + 1 + fx.org2.employees.length,
        skill_graph: fx.skills.length + fx.org2.skills.length,
        job_requisitions: fx.requisitions.length + 2,
        policy_documents: fx.policies.length,
        onboarding_journeys: 1 + fx.journeys.length,
        recommendations: RECOMMENDATIONS.length,
        assessment_blueprints: ASSESSMENT_SEEDS.length,
        assessment_rubrics: ASSESSMENT_SEEDS.reduce((n, s) => n + s.rubrics.length, 0),
        candidate_sessions: 2,
        evidence_items: fx.employees.reduce((n, e) => n + (e.assertions ?? []).length, 0) + fx.candidates.reduce((n, c) => n + (c.assertions ?? []).length, 0) + fx.org2.employees.reduce((n, e) => n + (e.assertions ?? []).length, 0),
        skill_assertions: fx.employees.reduce((n, e) => n + (e.assertions ?? []).length, 0) + fx.candidates.reduce((n, c) => n + (c.assertions ?? []).length, 0) + fx.org2.employees.reduce((n, e) => n + (e.assertions ?? []).length, 0),
        applications: fx.requisitions.reduce((n, r) => n + (r.applicants ?? []).length, 0),
        workforce_observations: fx.observations.length,
      },
    });
  } catch (err) {
    console.error("reset-demo failed:", err);
    return jsonResponse({ error: "INTERNAL", message: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
