import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit } from "../_shared/skill-graph-engine.ts";
import {
  buildCarryover,
  buildPlanDefs,
  deriveStates,
  estimateReadiness,
  materialize,
  planHash,
  type PlanTask,
  type TaskDef,
} from "../_shared/onboarding-v2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

function taskRow(planId: string, t: PlanTask) {
  return {
    org_id: null, // filled by caller
    plan_id: planId,
    version: null, // filled by caller
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
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: { twin_id?: string; regen?: boolean; start_date?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const twinId = (body.twin_id ?? "").trim();
  if (!twinId) return json({ error: "VALIDATION_ERROR", message: "twin_id is required." }, 400);

  const { data: twin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, org_id, role, name, job_title, verified_skills, seniority_level, computed_fits, audit_events, manager_id")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !twin) return json({ error: "NOT_FOUND" }, 404);

  // Visibility: HR/partner see anyone; manager sees team + self; employee self only; IT sees all org (service view).
  let allowed = false;
  if (["hr_executive", "hr_partner", "it_security"].includes(caller.role)) allowed = twin.org_id === caller.org_id;
  else if (caller.role === "manager" || caller.role === "employee") {
    allowed = twin.id === caller.id || (caller.role === "manager" && (await isTeamMember(supabase, caller.id, twin.id)));
  }
  if (!allowed) return json({ error: "FORBIDDEN" }, 403);

  // -------------------------------------------------------------------------
  // Approved role relationship: the employee's SELECTED application binds the
  // plan to a real requisition. NEVER a title substring match.
  // -------------------------------------------------------------------------
  const { data: appRows } = await supabase
    .from("applications")
    .select("id, requisition_id, stage")
    .eq("org_id", twin.org_id)
    .eq("candidate_twin_id", twinId)
    .eq("stage", "selected")
    .order("applied_at", { ascending: false })
    .limit(5);
  const approvedApp = (appRows ?? []).find((a) => a.stage === "selected");
  if (!approvedApp) {
    return json(
      { error: "NO_APPROVED_ROLE", message: "No approved application (selected role) is on file for this employee. Plans are built from the approved role relationship only — not from a title guess." },
      400
    );
  }

  const { data: reqRow } = await supabase
    .from("job_requisitions")
    .select("id, title, required_skills, future_skills, seniority_level")
    .eq("id", approvedApp.requisition_id)
    .maybeSingle();
  if (!reqRow) return json({ error: "NOT_FOUND", message: "Approved requisition not found." }, 404);

  const { data: polRows } = await supabase
    .from("policy_documents")
    .select("doc_code, title")
    .eq("org_id", twin.org_id);
  const policyDocs = (polRows ?? []) as { doc_code: string; title: string }[];

  const { data: graphRows } = await supabase
    .from("skill_graph")
    .select("skill, category, outgoing_edges")
    .eq("org_id", twin.org_id);

  const now = new Date().toISOString();
  const startDate = body.start_date ?? now;

  // Fit context (informational — the plan itself is built from gaps).
  const fitCurrent = computeFit({
    candidateSkills: (twin.verified_skills ?? []) as { name: string; proficiency: number }[],
    candidateLevel: twin.seniority_level ?? 3,
    requiredSkills: (reqRow.required_skills ?? []) as { skill: string; target_proficiency: number }[],
    roleLevel: reqRow.seniority_level ?? 3,
    skillGraph: graphRows ?? [],
    target: { type: "requisition", id: reqRow.id, title: reqRow.title },
    scenario: "current",
    computedAt: now,
  });

  const defs: TaskDef[] = buildPlanDefs({
    role: reqRow,
    verified_skills: (twin.verified_skills ?? []) as { name: string; proficiency: number }[],
    policy_docs: policyDocs,
  });
  const hash = planHash(defs);

  // Latest plan for the twin (any status) — for carryover + supersession.
  const { data: prevPlans } = await supabase
    .from("onboarding_plans")
    .select("id, version, status")
    .eq("org_id", twin.org_id)
    .eq("twin_id", twinId)
    .order("version", { ascending: false })
    .limit(1);
  const prevPlan = (prevPlans ?? [])[0];

  // A plain build (no regen) with an existing non-superseded plan is a no-op —
  // version churn only happens on explicit regeneration.
  if (prevPlan && prevPlan.status !== "superseded" && body.regen !== true) {
    const { data: noopTasks } = await supabase
      .from("onboarding_tasks")
      .select("task_code, title, task_type, owner_role, required, non_waivable, depends_on, duration_days, due_date, topological_level, why_evidence, evidence_requirements, state, completion_record, blockers, waiver, adaptation")
      .eq("plan_id", prevPlan.id)
      .order("topological_level", { ascending: true });
    return json({
      ok: true,
      plan: {
        id: prevPlan.id,
        twin_id: twinId,
        version: prevPlan.version,
        plan_hash: (prevPlan as unknown as { plan_hash?: string }).plan_hash ?? hash,
        status: prevPlan.status,
        start_date: startDate,
        generated_at: now,
        readiness: (prevPlan as unknown as { readiness?: unknown }).readiness ?? {},
        carryover: (prevPlan as unknown as { carryover?: unknown[] }).carryover ?? [],
        requisition: { id: reqRow.id, title: reqRow.title },
        fit_current: fitCurrent.score,
        tasks: (noopTasks ?? []) as unknown[],
      },
    });
  }

  let tasks: PlanTask[] = deriveStates(defs, { approved: false, startDate });
  let carryover: { task_code: string; from_version: number; from_plan_id: string; note: string }[] = [];
  let version = 1;

  if (prevPlan) {
    const { data: prevTaskRows } = await supabase
      .from("onboarding_tasks")
      .select("*")
      .eq("plan_id", prevPlan.id);
    const prevTasks = (prevTaskRows ?? []) as unknown[];
    const mapped: PlanTask[] = (prevTasks as {
      task_code: string; title: string; task_type: string; owner_role: string; required: boolean;
      non_waivable: boolean; depends_on: string[]; duration_days: number; why_evidence: unknown;
      evidence_requirements: unknown[]; state: string; completion_record: unknown; blockers: unknown[];
      waiver: unknown; adaptation: unknown;
    }[]).map((r) => ({
      task_code: r.task_code,
      title: r.title,
      task_type: r.task_type as PlanTask["task_type"],
      owner_role: r.owner_role as PlanTask["owner_role"],
      required: r.required,
      non_waivable: r.non_waivable,
      depends_on: r.depends_on ?? [],
      duration_days: Number(r.duration_days),
      why_evidence: r.why_evidence as PlanTask["why_evidence"],
      evidence_requirements: (r.evidence_requirements ?? []) as PlanTask["evidence_requirements"],
      state: r.state as PlanTask["state"],
      start_date: null,
      due_date: null,
      topological_level: 0,
      blocked_reasons: [],
      blockers: (r.blockers ?? []) as PlanTask["blockers"],
      waiver: r.waiver as PlanTask["waiver"],
      completion_record: r.completion_record as PlanTask["completion_record"],
      adaptation: r.adaptation as PlanTask["adaptation"],
    }));

    const carried = buildCarryover(mapped, defs, prevPlan.id, prevPlan.version);
    tasks = carried.tasks;
    carryover = carried.entries;
    version = prevPlan.version + 1;
  }

  // Recompute the full scheduled view (dates/levels/states) from the defs.
  const done = tasks.filter((t) => t.state === "done").map((t) => t.task_code);
  const waived = tasks.filter((t) => t.state === "waived").map((t) => t.task_code);
  const blockers: Record<string, PlanTask["blockers"]> = {};
  for (const t of tasks) if (t.blockers.length > 0) blockers[t.task_code] = t.blockers;
  const derived = materialize(
    deriveStates(defs, { approved: true, startDate, done, waived, blockers }),
    { completion: Object.fromEntries(tasks.filter((t) => t.completion_record).map((t) => [t.task_code, t.completion_record!])),
      waiver: Object.fromEntries(tasks.filter((t) => t.waiver).map((t) => [t.task_code, t.waiver!])),
      blockers }
  );
  tasks = derived;
  const readiness = estimateReadiness(defs, tasks, startDate, now);

  // Supersede any prior plan — old approvals never carry (no retained approved state).
  if (prevPlan && prevPlan.status !== "superseded") {
    await supabase
      .from("onboarding_plans")
      .update({ status: "superseded", audit_events: [...((prevPlan as unknown as { audit_events?: unknown[] }).audit_events ?? []), { actor: caller.email ?? uid, action: "superseded_by_regeneration", note: `Superseded by plan v${version}.`, timestamp: now }] })
      .eq("id", prevPlan.id);
  }

  const planRow = {
    org_id: twin.org_id,
    twin_id: twinId,
    application_id: approvedApp.id,
    version,
    plan_hash: hash,
    status: "pending_approval",
    manager_approval: null,
    hr_approval: null,
    start_date: startDate,
    generated_at: now,
    readiness,
    carryover,
    audit_events: [
      { actor: caller.email ?? uid, action: prevPlan ? "plan_regenerated" : "plan_generated", note: `Plan v${version} built from approved role "${reqRow.title}" — ${defs.length} tasks, ${carryover.length} carried.`, timestamp: now },
    ],
  };
  const { data: inserted, error: insErr } = await supabase
    .from("onboarding_plans")
    .insert(planRow)
    .select("id")
    .single();
  if (insErr || !inserted) return json({ error: "INTERNAL", message: insErr?.message ?? "plan insert failed" }, 500);
  const planId = inserted.id;

  const { error: taskErr } = await supabase
    .from("onboarding_tasks")
    .insert(tasks.map((t) => ({ ...taskRow(planId, t), org_id: twin.org_id, version })));
  if (taskErr) {
    await supabase.from("onboarding_plans").delete().eq("id", planId);
    return json({ error: "INTERNAL", message: taskErr.message }, 500);
  }

  // Persist fits + audit on the twin.
  const fits = (twin.computed_fits ?? []) as { target_id: string; scenario: string }[];
  const nextFits = [...fits.filter((f) => !(f.target_id === reqRow.id && f.scenario === "current")), fitCurrent as unknown as { target_id: string; scenario: string }];
  await supabase
    .from("digital_twins")
    .update({
      computed_fits: nextFits,
      audit_events: [
        ...(twin.audit_events ?? []),
        { actor: caller.email ?? uid, action: "plan_fit_computed", note: `Role fit current ${fitCurrent.score.toFixed(2)}.`, timestamp: now },
      ],
    })
    .eq("id", twinId);

  return json({
    ok: true,
    plan: {
      id: planId,
      twin_id: twinId,
      version,
      plan_hash: hash,
      status: "pending_approval",
      start_date: startDate,
      generated_at: now,
      readiness,
      carryover,
      requisition: { id: reqRow.id, title: reqRow.title },
      fit_current: fitCurrent.score,
      tasks,
    },
  });
});
