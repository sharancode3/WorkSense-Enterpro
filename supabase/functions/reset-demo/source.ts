import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  buildTwins,
  DEMO_ACCOUNTS,
  DEMO_ORG_ID,
  SECOND_ORG_ID,
  POLICIES,
  RECOMMENDATIONS,
  SEED_JOURNEY,
} from "../_shared/seed-data.ts";
import { SEED_FITS } from "../_shared/generated-seed-fits.ts";
import { DEMO_FIXTURES } from "../_shared/generated-demo-fixtures.ts";

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
    await supabase.from("assessments").delete().eq("org_id", orgId);
    await supabase.from("applications").delete().eq("org_id", orgId);
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
    const { created, idByEmail } = await ensureDemoAuthUsers(supabase);
    await reseed(supabase, idByEmail);
    const fx = DEMO_FIXTURES;
    return jsonResponse({
      ok: true,
      created_users: created,
      seeded: {
        organizations: 2,
        digital_twins: fx.employees.length + fx.candidates.length + 1 + fx.org2.employees.length,
        skill_graph: fx.skills.length + fx.org2.skills.length,
        job_requisitions: fx.requisitions.length + 1,
        policy_documents: fx.policies.length,
        onboarding_journeys: 1 + fx.journeys.length,
        recommendations: RECOMMENDATIONS.length,
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
