import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { notifyScanAfter } from "../_shared/notify-hook.ts";
import {
  applyWaiver,
  attemptHash,
  buildCarryover,
  canActOnTask,
  canAdapt,
  canWaive,
  deriveStates,
  estimateReadiness,
  materialize,
  planHash,
  validateCompletion,
  type Adaptation,
  type Blocker,
  type CompletionRecord,
  type PlanTask,
  type TaskDef,
  type WaiverInput,
} from "../_shared/onboarding-v2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function rowToTask(r: Record<string, unknown>): PlanTask {
  return {
    task_code: String(r.task_code),
    title: String(r.title),
    task_type: r.task_type as PlanTask["task_type"],
    owner_role: r.owner_role as PlanTask["owner_role"],
    required: Boolean(r.required),
    non_waivable: Boolean(r.non_waivable),
    depends_on: (r.depends_on ?? []) as string[],
    duration_days: Number(r.duration_days),
    why_evidence: r.why_evidence as PlanTask["why_evidence"],
    evidence_requirements: (r.evidence_requirements ?? []) as PlanTask["evidence_requirements"],
    state: r.state as PlanTask["state"],
    start_date: (r.due_date as string | null) ?? null,
    due_date: (r.due_date as string | null) ?? null,
    topological_level: Number(r.topological_level ?? 0),
    blocked_reasons: [],
    blockers: (r.blockers ?? []) as Blocker[],
    waiver: r.waiver as PlanTask["waiver"],
    completion_record: r.completion_record as CompletionRecord | null,
    adaptation: r.adaptation as Adaptation | null,
  };
}

function recompute(defs: TaskDef[], facts: {
  done: string[]; waived: string[]; failed: string[]; blockers: Record<string, Blocker[]>;
  completion: Record<string, CompletionRecord>; waiver: Record<string, WaiverInput>;
  adaptation: Record<string, Adaptation>;
}, startDate: string, now: string) {
  const tasks = materialize(
    deriveStates(defs, { approved: true, startDate, done: facts.done, waived: facts.waived, failed: facts.failed, blockers: facts.blockers }),
    { completion: facts.completion, waiver: facts.waiver, adaptation: facts.adaptation, blockers: facts.blockers }
  );
  const readiness = estimateReadiness(defs, tasks, startDate, now);
  return { tasks, readiness };
}

/** Best-effort audit insert — the action itself never fails because logging fails. */
async function logEvent(supabase, row: Record<string, unknown>): Promise<{ error?: { message?: string } } | null> {
  try {
    return await supabase.from("onboarding_task_events").insert(row);
  } catch {
    return null;
  }
}

/** Persist recomputed states for EVERY task row (downstream states cascade). */
async function syncTasks(supabase, orgId: string, planId: string, version: number, tasks: PlanTask[]): Promise<void> {
  for (const t of tasks) {
    await supabase
      .from("onboarding_tasks")
      .update({
        state: t.state,
        due_date: t.due_date,
        topological_level: t.topological_level,
        blockers: t.blockers,
        completion_record: t.completion_record,
        waiver: t.waiver,
        adaptation: t.adaptation,
      })
      .eq("org_id", orgId)
      .eq("plan_id", planId)
      .eq("version", version)
      .eq("task_code", t.task_code);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    return await handle(supabase, req);
  } catch (err) {
    console.error("onboarding-task unhandled:", err);
    return json({ error: "INTERNAL", message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }, 500);
  }
});

async function handle(supabase: ReturnType<typeof createClient>, req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id, name")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: {
    plan_id?: string; task_code?: string; action?: string; evidence?: { kind: string; label: string; value: string }[];
    note?: string; blocker_id?: string; waiver?: { reason?: string; policy_basis?: { doc_code?: string; version?: number | null } | null };
    skill?: string; source_evidence?: { source_type: string; fact: string; ref?: string }[];
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const planId = (body.plan_id ?? "").trim();
  const taskCode = (body.task_code ?? "").trim();
  const action = body.action ?? "";
  if (!planId || !taskCode || !["complete", "block", "resolve", "waive", "adapt", "fail"].includes(action)) {
    return json({ error: "VALIDATION_ERROR", message: "plan_id, task_code and action (complete|block|resolve|waive|adapt|fail) are required." }, 400);
  }

  const { data: plan, error: planErr } = await supabase
    .from("onboarding_plans")
    .select("id, org_id, twin_id, version, plan_hash, status, start_date, readiness, audit_events")
    .eq("id", planId)
    .maybeSingle();
  if (planErr || !plan) return json({ error: "NOT_FOUND" }, 404);
  if (plan.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  const { data: twin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, name, manager_id, org_id, verified_skills, seniority_level")
    .eq("id", plan.twin_id)
    .maybeSingle();
  if (twinErr || !twin) return json({ error: "NOT_FOUND" }, 404);

  const { data: taskRows } = await supabase
    .from("onboarding_tasks")
    .select("*")
    .eq("plan_id", planId);
  const allTasks = ((taskRows ?? []) as Record<string, unknown>[]).map(rowToTask);
  const target = allTasks.find((t) => t.task_code === taskCode);
  if (!target) return json({ error: "NOT_FOUND", message: "Task not found in this plan version." }, 404);

  // All mutating actions require an active (dual-approved) plan — blockers,
  // waivers and adaptations are execution-time decisions.
  if (plan.status !== "approved") {
    return json({ error: "CONFLICT", code: "plan_pending", message: "The plan must be approved by the Manager and HR Executive before tasks can be changed." }, 400);
  }

  const startDate = plan.start_date as string;
  const now = new Date().toISOString();

  const factsOf = (tasks: PlanTask[]) => ({
    done: tasks.filter((t) => t.state === "done").map((t) => t.task_code),
    waived: tasks.filter((t) => t.state === "waived").map((t) => t.task_code),
    failed: tasks.filter((t) => t.state === "failed").map((t) => t.task_code),
    blockers: Object.fromEntries(tasks.filter((t) => t.blockers.length > 0).map((t) => [t.task_code, t.blockers])),
    completion: Object.fromEntries(tasks.filter((t) => t.completion_record).map((t) => [t.task_code, t.completion_record!])),
    waiver: Object.fromEntries(tasks.filter((t) => t.waiver).map((t) => [t.task_code, t.waiver!])),
    adaptation: Object.fromEntries(tasks.filter((t) => t.adaptation).map((t) => [t.task_code, t.adaptation!])),
  });

  const defsOf = (tasks: PlanTask[]): TaskDef[] =>
    tasks.map((t) => ({
      task_code: t.task_code,
      title: t.title,
      task_type: t.task_type,
      owner_role: t.owner_role,
      required: t.required,
      non_waivable: t.non_waivable,
      depends_on: t.depends_on,
      duration_days: t.duration_days,
      why_evidence: t.why_evidence,
      evidence_requirements: t.evidence_requirements,
    }));

  const appendAudit = (note: string, extra: Record<string, unknown> = {}) =>
    [...((plan.audit_events as unknown[]) ?? []), { actor: caller.email ?? uid, action, note, timestamp: now, ...extra }];

  // -------------------------------------------------------------------------
  // COMPLETE — server-side completion checks + genuine evidence + dedup
  // -------------------------------------------------------------------------
  if (action === "complete") {
    if (plan.status !== "approved") {
      return json({ error: "CONFLICT", code: "plan_pending", message: "The plan must be approved by the Manager and HR Executive before tasks can be completed." }, 400);
    }
    const evidence = (body.evidence ?? []).map((e) => ({
      kind: e.kind as "note" | "assessment_id",
      label: e.label,
      value: String(e.value ?? "").trim(),
    }));
    const check = validateCompletion({
      planStatus: plan.status,
      task: target,
      actor: { id: caller.id, role: caller.role, org_id: caller.org_id },
      twin: { id: twin.id, manager_id: twin.manager_id, org_id: twin.org_id },
      evidence,
    });
    if (!check.ok) {
      const ah = attemptHash(planId, taskCode, action, { evidence, note: body.note });
      await logEvent(supabase, {
        org_id: plan.org_id, plan_id: planId, task_code: taskCode, actor_twin_id: caller.id,
        action, attempt_hash: ah, result: "rejected", note: check.error, evidence: { evidence, note: body.note },
      });
      return json({ error: "CONFLICT", code: check.code ?? "CONFLICT", message: check.error }, 400);
    }

    const ah = attemptHash(planId, taskCode, action, { evidence, note: body.note });
    const completion: CompletionRecord = {
      actor_twin_id: caller.id,
      actor_name: caller.name ?? caller.email ?? caller.id,
      at: now,
      evidence,
      attempt_hash: ah,
      note: body.note ? String(body.note).trim() : undefined,
    };
    // Dedup: the same payload on the same task is a double submission.
    const { error: evErr } = await logEvent(supabase, {
      org_id: plan.org_id, plan_id: planId, task_code: taskCode, actor_twin_id: caller.id,
      action, attempt_hash: ah, result: "applied", note: "Task completed with evidence.", evidence: { evidence, note: body.note },
    });
    if (evErr) {
      return json({ error: "CONFLICT", code: "double_submission", message: "This completion was already recorded (duplicate attempt hash)." }, 400);
    }

    const facts = factsOf(allTasks);
    facts.done.push(taskCode);
    facts.completion[taskCode] = completion;
    const { tasks: next, readiness } = recompute(defsOf(allTasks), facts, startDate, now);

    await syncTasks(supabase, plan.org_id, planId, plan.version, next);
    await supabase
      .from("onboarding_plans")
      .update({ readiness, audit_events: appendAudit(`${twin.name} completed "${target.title}" with evidence.`) })
      .eq("id", planId);

    // Authoritative transition → schedule idempotent notification generation.
  void notifyScanAfter(plan.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return json({ ok: true, action, task_code: taskCode, state: "done", readiness, completion });
  }

  // -------------------------------------------------------------------------
  // BLOCK — report an open blocker (multiple allowed)
  // -------------------------------------------------------------------------
  if (action === "block") {
    const auth = canActOnTask({ id: caller.id, role: caller.role, org_id: caller.org_id }, target.owner_role, { id: twin.id, manager_id: twin.manager_id, org_id: twin.org_id });
    if (!auth.ok && caller.role !== "hr_executive") return json({ error: "FORBIDDEN", message: auth.error }, 403);
    const note = String(body.note ?? "").trim() || "Blocker reported.";
    const blocker: Blocker = { id: crypto.randomUUID(), note, reported_by: caller.email ?? caller.id, at: now, status: "open" };
    const facts = factsOf(allTasks);
    facts.blockers[taskCode] = [...(facts.blockers[taskCode] ?? []), blocker];
    const { tasks: next, readiness } = recompute(defsOf(allTasks), facts, startDate, now);
    await syncTasks(supabase, plan.org_id, planId, plan.version, next);
    await supabase
      .from("onboarding_plans")
      .update({ readiness, audit_events: appendAudit(`Blocker on "${target.title}": ${note}`) })
      .eq("id", planId);
    await supabase.from("onboarding_task_events").insert({
      org_id: plan.org_id, plan_id: planId, task_code: taskCode, actor_twin_id: caller.id,
      action, attempt_hash: attemptHash(planId, taskCode, action, { note, blocker_id: blocker.id }), result: "applied", note, evidence: { blocker_id: blocker.id },
    });
  // Authoritative transition → schedule idempotent notification generation.
  void notifyScanAfter(plan.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    return json({ ok: true, action, task_code: taskCode, state: next.find((t) => t.task_code === taskCode)!.state, blockers: next.find((t) => t.task_code === taskCode)!.blockers, readiness });
  }

  // -------------------------------------------------------------------------
  // RESOLVE — resolve ONE open blocker; others stay
  // -------------------------------------------------------------------------
  if (action === "resolve") {
    const blockerId = (body.blocker_id ?? "").trim();
    if (!blockerId) return json({ error: "VALIDATION_ERROR", message: "blocker_id is required to resolve a blocker." }, 400);
    const auth = canActOnTask({ id: caller.id, role: caller.role, org_id: caller.org_id }, target.owner_role, { id: twin.id, manager_id: twin.manager_id, org_id: twin.org_id });
    const isSupervisor = caller.role === "manager" && twin.manager_id === caller.id;
    const isHR = caller.role === "hr_executive" || caller.role === "hr_partner";
    if (!auth.ok && !isSupervisor && !isHR) return json({ error: "FORBIDDEN", message: auth.error }, 403);

    const blockers = target.blockers;
    const idx = blockers.findIndex((b) => b.id === blockerId);
    if (idx === -1) return json({ error: "NOT_FOUND", message: "Blocker not found on this task." }, 404);
    if (blockers[idx].status !== "open") return json({ error: "CONFLICT", message: "Blocker is already resolved." }, 409);
    const resolvedBlocker = { ...blockers[idx], status: "resolved" as const, resolved_by: caller.name ?? caller.email ?? caller.id, resolved_at: now };
    const nextBlockers = blockers.map((b) => (b.id === blockerId ? resolvedBlocker : b));

    const facts = factsOf(allTasks);
    facts.blockers[taskCode] = nextBlockers;
    const { tasks: next, readiness } = recompute(defsOf(allTasks), facts, startDate, now);
    await syncTasks(supabase, plan.org_id, planId, plan.version, next);
    await supabase
      .from("onboarding_plans")
      .update({ readiness, audit_events: appendAudit(`Blocker resolved on "${target.title}" by ${caller.name ?? caller.email}.`) })
      .eq("id", planId);
    await logEvent(supabase, {
      org_id: plan.org_id, plan_id: planId, task_code: taskCode, actor_twin_id: caller.id,
      action, attempt_hash: attemptHash(planId, taskCode, action, { blocker_id: blockerId }), result: "applied", note: "Blocker resolved.", evidence: { blocker_id: blockerId },
    });
  // Authoritative transition → schedule idempotent notification generation.
  void notifyScanAfter(plan.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    return json({ ok: true, action, task_code: taskCode, state: next.find((t) => t.task_code === taskCode)!.state, blockers: nextBlockers, readiness });
  }

  // -------------------------------------------------------------------------
  // WAIVE — authorized actor + reason + policy basis + audit + recompute
  // -------------------------------------------------------------------------
  if (action === "waive") {
    const waiverAuth = canWaive(
      { id: caller.id, role: caller.role },
      { manager_id: twin.manager_id },
      target.non_waivable,
      target.owner_role
    );
    if (!waiverAuth.ok) return json({ error: "FORBIDDEN", message: waiverAuth.error }, 403);
    const reason = String(body.waiver?.reason ?? "").trim();
    if (!reason) return json({ error: "VALIDATION_ERROR", message: "A waiver reason is required." }, 400);
    let policyBasis: { doc_code: string; version: number | null } | null = null;
    if (body.waiver?.policy_basis?.doc_code) {
      const docCode = body.waiver.policy_basis.doc_code.trim();
      const { data: docRow } = await supabase
        .from("policy_documents")
        .select("doc_code, version")
        .eq("org_id", plan.org_id)
        .eq("doc_code", docCode)
        .order("version", { ascending: false })
        .limit(1);
      const doc = (docRow ?? [])[0];
      if (!doc) return json({ error: "VALIDATION_ERROR", message: `Policy basis ${docCode} does not exist.` }, 400);
      policyBasis = { doc_code: doc.doc_code, version: doc.version as number | null };
    } else if (target.non_waivable) {
      return json({ error: "VALIDATION_ERROR", message: "A non-waivable task waiver requires a policy basis citation." }, 400);
    }

    const waiver: WaiverInput = {
      by_twin_id: caller.id,
      by_name: caller.name ?? caller.email ?? caller.id,
      reason,
      policy_basis: policyBasis,
      at: now,
    };
    const facts = factsOf(allTasks);
    facts.waived.push(taskCode);
    facts.waiver[taskCode] = waiver;
    const { tasks: next, readiness } = recompute(defsOf(allTasks), facts, startDate, now);
    await syncTasks(supabase, plan.org_id, planId, plan.version, next);
    await supabase
      .from("onboarding_plans")
      .update({ readiness, audit_events: appendAudit(`${twin.name}: "${target.title}" waived — ${reason}${policyBasis ? ` (policy ${policyBasis.doc_code})` : ""}.`) })
      .eq("id", planId);
    await logEvent(supabase, {
      org_id: plan.org_id, plan_id: planId, task_code: taskCode, actor_twin_id: caller.id,
      action, attempt_hash: attemptHash(planId, taskCode, action, { reason, policy_basis: policyBasis }), result: "applied", note: reason, evidence: { reason, policy_basis: policyBasis },
    });
  // Authoritative transition → schedule idempotent notification generation.
  void notifyScanAfter(plan.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    return json({ ok: true, action, task_code: taskCode, state: "waived", waiver, readiness });
  }

  // -------------------------------------------------------------------------
  // ADAPT — new assessment evidence: learning task -> verification task
  // -------------------------------------------------------------------------
  if (action === "adapt") {
    const adaptAuth = canAdapt({ id: caller.id, role: caller.role }, { manager_id: twin.manager_id });
    if (!adaptAuth.ok) return json({ error: "FORBIDDEN", message: adaptAuth.error }, 403);
    if (target.task_type !== "learning") {
      return json({ error: "VALIDATION_ERROR", message: "Only learning tasks can be adapted into a verification task." }, 400);
    }
    const skill = String(body.skill ?? "").trim();
    if (!skill) return json({ error: "VALIDATION_ERROR", message: "skill is required to build the verification task." }, 400);
    const reason = String(body.note ?? "").trim() || `New assessment evidence covers ${skill}; verification replaces further learning.`;
    const sourceEvidence = (body.source_evidence ?? []).length > 0
      ? (body.source_evidence ?? [])
      : [{ source_type: "assessment", fact: `Assessment evidence for ${skill}.` }];

    // Rebuild defs: drop the learning task, add a verification task in its place
    // and re-point anything that depended on it.
    const oldCode = target.task_code;
    const newCode = `verify_${oldCode.replace(/^learn_/, "")}`;
    // The verification task must not already exist for that skill (plan builder
    // already adds one for the first gap).
    if (allTasks.some((t) => t.task_code === newCode)) {
      return json({ error: "CONFLICT", message: `A verification task "${newCode}" already exists in this plan — nothing to adapt.` }, 409);
    }
    const oldDefs = defsOf(allTasks);
    const verifyDef: TaskDef = {
      task_code: newCode,
      title: `Verification: ${skill} mastery assessment`,
      task_type: "verification",
      owner_role: "employee",
      required: true,
      non_waivable: false,
      depends_on: target.depends_on,
      duration_days: 0.5,
      why_evidence: {
        reason,
        source_evidence: sourceEvidence,
      },
      evidence_requirements: [{ kind: "assessment_id", label: "Assessment evidence id", required: true }],
    };
    const newDefs = oldDefs
      .filter((d) => d.task_code !== oldCode)
      .map((d) => (d.depends_on.includes(oldCode) ? { ...d, depends_on: d.depends_on.map((x) => (x === oldCode ? newCode : x)) } : d))
      .concat(verifyDef);

    const adaptation: Adaptation = { kind: "replaced", replaced_by: newCode, reason, source_evidence: sourceEvidence, at: now, actor_twin_id: caller.id };
    // Regenerate: new version + hash, approvals invalidated, completed work carried.
    const carried = buildCarryover(allTasks, newDefs, plan.id, plan.version);
    const hash = planHash(newDefs);
    const facts = factsOf(carried.tasks);
    const { tasks: next, readiness } = recompute(newDefs, facts, startDate, now);
    const newVersion = plan.version + 1;

    await supabase.from("onboarding_plans").update({ status: "superseded" }).eq("id", planId);
    const { data: newPlan } = await supabase.from("onboarding_plans").insert({
      org_id: plan.org_id, twin_id: twin.id, application_id: null, version: newVersion, plan_hash: hash,
      status: "pending_approval", manager_approval: null, hr_approval: null, start_date: startDate, generated_at: now,
      readiness, carryover: carried.entries,
      audit_events: [{ actor: caller.email ?? uid, action: "plan_adapted", note: `Learning task "${target.title}" adapted to verification (${skill}) — approvals invalidated, plan v${newVersion}.`, timestamp: now }],
    }).select("id").single();

    await supabase.from("onboarding_tasks").insert(
      next.map((t) => ({
        org_id: plan.org_id, plan_id: newPlan!.id, version: newVersion, task_code: t.task_code, title: t.title,
        task_type: t.task_type, owner_role: t.owner_role, required: t.required, non_waivable: t.non_waivable,
        depends_on: t.depends_on, duration_days: t.duration_days, due_date: t.due_date, topological_level: t.topological_level,
        why_evidence: t.why_evidence, evidence_requirements: t.evidence_requirements, state: t.state,
        completion_record: t.completion_record, blockers: t.blockers, waiver: t.waiver,
        adaptation: t.task_code === newCode ? adaptation : t.adaptation,
      }))
    );

    await logEvent(supabase, {
      org_id: plan.org_id, plan_id: newPlan!.id, task_code: oldCode, actor_twin_id: caller.id,
      action, attempt_hash: attemptHash(planId, oldCode, action, { skill }), result: "applied", note: reason, evidence: { skill, replaced_by: newCode, source_evidence: sourceEvidence },
    });

  // Authoritative transition → schedule idempotent notification generation.
  void notifyScanAfter(plan.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    return json({ ok: true, action, task_code: oldCode, replaced_by: newCode, plan_id: newPlan!.id, version: newVersion, status: "pending_approval", plan_hash: hash, readiness });
  }

  // -------------------------------------------------------------------------
  // FAIL — verification failed: reopen the gap and revise the plan
  // -------------------------------------------------------------------------
  if (action === "fail") {
    const adaptAuth = canAdapt({ id: caller.id, role: caller.role }, { manager_id: twin.manager_id });
    if (!adaptAuth.ok) return json({ error: "FORBIDDEN", message: adaptAuth.error }, 403);
    if (target.task_type !== "verification") {
      return json({ error: "VALIDATION_ERROR", message: "Only verification tasks can be failed (reopening the gap)." }, 400);
    }
    const reason = String(body.note ?? "").trim() || "Verification did not confirm the skill at target — gap re-opened.";
    const sourceEvidence = (body.source_evidence ?? []).length > 0
      ? (body.source_evidence ?? [])
      : [{ source_type: "verification", fact: reason }];
    const skill = String(body.skill ?? "").trim() || target.title.replace(/^Verification:\s*/, "").replace(/ mastery assessment$/, "");

    // Revised defs: failed verification task is retired; a re-learning task is
    // added in its place (gap re-opened), dependents re-pointed.
    const oldCode = target.task_code;
    const reopenCode = `learn_${skill.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_reopen`;
    const oldDefs = defsOf(allTasks);
    const reopenDef: TaskDef = {
      task_code: reopenCode,
      title: `Re-learning: ${skill} (verified gap re-opened)`,
      task_type: "learning",
      owner_role: "employee",
      required: true,
      non_waivable: false,
      depends_on: target.depends_on,
      duration_days: 1,
      why_evidence: {
        reason: `Verification of ${skill} failed — the gap is re-opened for learning.`,
        source_evidence: sourceEvidence,
      },
      evidence_requirements: [{ kind: "note", label: `Contribution evidence: ${skill}`, required: true }],
    };
    const newDefs = oldDefs
      .filter((d) => d.task_code !== oldCode)
      .map((d) => (d.depends_on.includes(oldCode) ? { ...d, depends_on: d.depends_on.map((x) => (x === oldCode ? reopenCode : x)) } : d))
      .concat(reopenDef);

    const adaptation: Adaptation = { kind: "reopened_gap", reason, source_evidence: sourceEvidence, at: now, actor_twin_id: caller.id };
    const carried = buildCarryover(allTasks, newDefs, plan.id, plan.version);
    const hash = planHash(newDefs);
    const facts = factsOf(carried.tasks);
    const { tasks: next, readiness } = recompute(newDefs, facts, startDate, now);
    const newVersion = plan.version + 1;

    await supabase.from("onboarding_plans").update({ status: "superseded" }).eq("id", planId);
    const { data: newPlan } = await supabase.from("onboarding_plans").insert({
      org_id: plan.org_id, twin_id: twin.id, application_id: null, version: newVersion, plan_hash: hash,
      status: "pending_approval", manager_approval: null, hr_approval: null, start_date: startDate, generated_at: now,
      readiness, carryover: carried.entries,
      audit_events: [{ actor: caller.email ?? uid, action: "plan_revised", note: `Verification "${target.title}" failed — gap for ${skill} re-opened; plan v${newVersion} pending approval.`, timestamp: now }],
    }).select("id").single();

    await supabase.from("onboarding_tasks").insert(
      next.map((t) => ({
        org_id: plan.org_id, plan_id: newPlan!.id, version: newVersion, task_code: t.task_code, title: t.title,
        task_type: t.task_type, owner_role: t.owner_role, required: t.required, non_waivable: t.non_waivable,
        depends_on: t.depends_on, duration_days: t.duration_days, due_date: t.due_date, topological_level: t.topological_level,
        why_evidence: t.why_evidence, evidence_requirements: t.evidence_requirements, state: t.state,
        completion_record: t.completion_record, blockers: t.blockers, waiver: t.waiver,
        adaptation: t.task_code === reopenCode ? null : t.adaptation,
      }))
    );

    await logEvent(supabase, {
      org_id: plan.org_id, plan_id: newPlan!.id, task_code: oldCode, actor_twin_id: caller.id,
      action, attempt_hash: attemptHash(planId, oldCode, action, { skill }), result: "applied", note: reason, evidence: { skill, reopened_by: reopenCode, source_evidence: sourceEvidence },
    });

  // Authoritative transition → schedule idempotent notification generation.
  void notifyScanAfter(plan.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    return json({ ok: true, action, task_code: oldCode, reopened_by: reopenCode, plan_id: newPlan!.id, version: newVersion, status: "pending_approval", plan_hash: hash, readiness });
  }

  return json({ error: "VALIDATION_ERROR", message: "Unknown action." }, 400);
}
