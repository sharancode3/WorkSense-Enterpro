import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit, fitKey } from "../_shared/skill-graph-engine.ts";
import { CycleError, schedulePlan, type TaskInput } from "../_shared/onboarding-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const normId = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

const CORE_TASKS: TaskInput[] = [
  { id: "it", title: "IT & Laptop Provisioning", depends_on: [], duration_days: 1 },
  { id: "security", title: "Security & Compliance Training", depends_on: [], non_waivable: true, duration_days: 1 },
  { id: "payroll", title: "Direct Deposit & Payroll Setup", depends_on: [], non_waivable: true, duration_days: 0.5 },
  { id: "access", title: "System Access & SSO", depends_on: ["it", "security"], duration_days: 0.5 },
  { id: "compliance_signoff", title: "Compliance Sign-off", depends_on: ["security"], non_waivable: true, duration_days: 0.5 },
  { id: "team_intro", title: "Team Introduction & Codebase Walkthrough", depends_on: ["access"], duration_days: 1 },
];

async function isTeamMember(supabase, rootTwinId: string, checkTwinId: string): Promise<boolean> {
  const { data } = await supabase.from("digital_twins").select("id, manager_id");
  const children = new Map<string, string[]>();
  for (const t of data ?? []) {
    if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
  }
  const seen = new Set<string>();
  const stack = [rootTwinId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of children.get(cur) ?? []) stack.push(c);
  }
  return seen.has(checkTwinId);
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
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: { twin_id?: string; req_id?: string; start_date?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const twinId = (body.twin_id ?? "").trim();
  if (!twinId) return json({ error: "VALIDATION_ERROR", message: "twin_id is required." }, 400);

  const { data: twin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, org_id, role, name, job_title, verified_skills, seniority_level, computed_fits, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !twin) return json({ error: "NOT_FOUND" }, 404);

  // Visibility: HR/partner see anyone; manager sees team + self; employee self only.
  let allowed = false;
  if (["hr_executive", "hr_partner"].includes(caller.role)) allowed = twin.org_id === caller.org_id;
  else if (caller.role === "manager" || caller.role === "employee") {
    allowed = twin.id === caller.id || (caller.role === "manager" && (await isTeamMember(supabase, caller.id, twin.id)));
  }
  if (!allowed) return json({ error: "FORBIDDEN" }, 403);

  // Role skills: explicit req, else a requisition whose title matches the job title.
  let reqRow: { id: string; title: string; required_skills: { skill: string; target_proficiency: number }[]; future_skills: { skill: string; target_proficiency: number }[]; seniority_level: number } | null = null;
  if (body.req_id) {
    const { data } = await supabase.from("job_requisitions").select("id, title, required_skills, future_skills, seniority_level").eq("id", body.req_id).maybeSingle();
    reqRow = data ?? null;
  }
  if (!reqRow) {
    const { data: all } = await supabase.from("job_requisitions").select("id, title, required_skills, future_skills, seniority_level");
    const job = (twin.job_title ?? "").toLowerCase();
    reqRow = (all ?? []).find(
      (r) => r.title.toLowerCase().includes(job) || job.includes(r.title.toLowerCase())
    ) ?? null;
  }

  const { data: graphRows } = await supabase
    .from("skill_graph")
    .select("skill, category, outgoing_edges")
    .eq("org_id", twin.org_id);

  const now = new Date().toISOString();
  const startDate = body.start_date ?? now;

  // Requirement 1: fit vs the employee's own role — current AND future skills.
  const fits = (twin.computed_fits ?? []) as { target_id: string; scenario: string }[];
  const fitCurrent = computeFit({
    candidateSkills: twin.verified_skills ?? [],
    candidateLevel: twin.seniority_level ?? 3,
    requiredSkills: reqRow?.required_skills ?? [],
    roleLevel: reqRow?.seniority_level ?? 3,
    skillGraph: graphRows ?? [],
    target: { type: "requisition", id: reqRow?.id ?? "own-role", title: reqRow?.title ?? twin.job_title ?? "Role" },
    scenario: "current",
    computedAt: now,
  });
  const fitFuture = computeFit({
    candidateSkills: twin.verified_skills ?? [],
    candidateLevel: twin.seniority_level ?? 3,
    requiredSkills: reqRow?.future_skills ?? [],
    roleLevel: reqRow?.seniority_level ?? 3,
    skillGraph: graphRows ?? [],
    target: { type: "requisition", id: reqRow?.id ?? "own-role", title: reqRow?.title ?? twin.job_title ?? "Role" },
    scenario: "future",
    computedAt: now,
  });
  const nextFits = fits.filter((f) => !(f.target_id === fitCurrent.target_id && f.scenario === "current") && !(f.target_id === fitFuture.target_id && f.scenario === "future")).concat([fitCurrent, fitFuture] as unknown as { target_id: string; scenario: string }[]);

  // Build the task graph: core + role skills + future skills + survey.
  const tasks: TaskInput[] = [...CORE_TASKS];
  const required = (reqRow?.required_skills ?? []).slice(0, 3);
  const future = (reqRow?.future_skills ?? []).slice(0, 2);
  const firstSkillId = required.length > 0 ? `skill_${normId(required[0].skill)}` : "team_intro";
  for (const s of required) {
    tasks.push({
      id: `skill_${normId(s.skill)}`,
      title: `First contribution using ${s.skill}`,
      skill: s.skill,
      target_proficiency: s.target_proficiency,
      depends_on: ["team_intro"],
      duration_days: 1,
    });
  }
  for (const s of future) {
    tasks.push({
      id: `future_${normId(s.skill)}`,
      title: `Upskilling plan: ${s.skill}`,
      skill: s.skill,
      target_proficiency: s.target_proficiency,
      depends_on: [firstSkillId],
      duration_days: 1,
    });
  }
  tasks.push({ id: "survey", title: "Onboarding Feedback Survey", depends_on: [firstSkillId], duration_days: 0.5 });

  let scheduled;
  try {
    scheduled = schedulePlan({
      tasks,
      skills: (twin.verified_skills ?? []) as { name: string; proficiency: number }[],
      startDate,
    });
  } catch (err) {
    if (err instanceof CycleError) {
      return json({ error: "VALIDATION_ERROR", message: err.message }, 400);
    }
    throw err;
  }

  const { data: existing } = await supabase
    .from("onboarding_journeys")
    .select("id, status, plan, audit_events")
    .eq("twin_id", twinId)
    .maybeSingle();

  const plan = {
    start_date: startDate,
    approvals: (existing?.plan as { approvals?: unknown[] })?.approvals ?? [],
    fit_current: fitCurrent.score,
    fit_future: fitFuture.score,
    generated_at: now,
  };
  const audit = [
    ...((existing?.audit_events as unknown[]) ?? []),
    { actor: caller.email ?? uid, action: existing ? "plan_regenerated" : "plan_generated", note: `Onboarding plan for ${twin.name}: ${scheduled.length} tasks, ${scheduled.filter((t) => t.waived).length} waived.`, timestamp: now },
  ];

  let journeyId = existing?.id;
  if (existing) {
    await supabase
      .from("onboarding_journeys")
      .update({ tasks: scheduled, status: "pending", plan, audit_events: audit })
      .eq("id", existing.id);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("onboarding_journeys")
      .insert({ org_id: twin.org_id, twin_id: twinId, tasks: scheduled, status: "pending", plan, audit_events: audit })
      .select("id")
      .single();
    if (insErr) return json({ error: "INTERNAL", message: insErr.message }, 500);
    journeyId = inserted.id;
  }

  // Persist fits + audit on the twin.
  await supabase
    .from("digital_twins")
    .update({
      computed_fits: nextFits,
      audit_events: [
        ...(twin.audit_events ?? []),
        { actor: caller.email ?? uid, action: "plan_fit_computed", note: `Role fit current ${fitCurrent.score.toFixed(2)} / future ${fitFuture.score.toFixed(2)}.`, timestamp: now },
      ],
    })
    .eq("id", twinId);

  return json({ ok: true, journey: { id: journeyId, status: "pending", plan, tasks: scheduled } });
});
