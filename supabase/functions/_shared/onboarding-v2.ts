// ---------------------------------------------------------------------------
// WorkSense Phase 8 onboarding engine — fully deterministic, zero LLM.
//  - Task definition vs execution state (separate column groups)
//  - Strict owner matrix: employee | manager | hr | it_security (no broad HR
//    to service owners)
//  - DAG planning from the APPROVED role relationship (application ->
//    requisition), never a title substring
//  - Cycle / missing-dep validation + Kahn topological scheduling
//  - Blocked set (multiple simultaneous blockers) + critical path
//  - Honest readiness estimate (never a guarantee)
//  - plan_hash bound to canonical task definitions (approvals bind to it)
//  - Waiver, adaptation (learning -> verification, failed verification reopens
//    gap), completion checks as PURE functions so backend functions just
//    load rows and apply them.
// ---------------------------------------------------------------------------

export type OwnerRole = "employee" | "manager" | "hr" | "it_security";
export type TaskType = "learning" | "verification" | "provisioning" | "policy" | "access" | "onboarding_admin";
export type TaskState = "pending" | "blocked" | "ready" | "in_progress" | "done" | "waived" | "failed";
export type PlanStatus = "draft" | "pending_approval" | "approved" | "completed" | "superseded";

export interface WhyEvidence {
  reason: string;
  source_evidence: { source_type: string; fact: string; ref?: string }[];
}

export interface EvReq {
  kind: "note" | "assessment_id";
  label: string;
  required: boolean;
}

/** Immutable task DEFINITION — what needs to happen. */
export interface TaskDef {
  task_code: string;
  title: string;
  task_type: TaskType;
  owner_role: OwnerRole;
  required: boolean;
  non_waivable: boolean;
  depends_on: string[];
  duration_days: number;
  why_evidence: WhyEvidence;
  evidence_requirements: EvReq[];
}

export interface Blocker {
  id: string;
  note: string;
  reported_by: string;
  at: string;
  status: "open" | "resolved";
}

export interface Waiver {
  by_twin_id: string;
  by_name: string;
  reason: string;
  policy_basis: { doc_code: string; version: number | null } | null;
  at: string;
}

export interface CompletionRecord {
  actor_twin_id: string;
  actor_name: string;
  at: string;
  evidence: { kind: "note" | "assessment_id"; label: string; value: string }[];
  attempt_hash: string;
  note?: string;
}

export interface Adaptation {
  kind: "replaced" | "reopened_gap";
  replaced_by?: string;
  reason: string;
  source_evidence: WhyEvidence["source_evidence"];
  at: string;
  actor_twin_id: string;
}

/** Task DEFINITION + EXECUTION state. */
export interface PlanTask extends TaskDef {
  state: TaskState;
  start_date: string | null;
  due_date: string | null;
  topological_level: number;
  blocked_reasons: string[]; // task_codes of unmet deps
  blockers: Blocker[];
  waiver: Waiver | null;
  completion_record: CompletionRecord | null;
  adaptation: Adaptation | null;
}

export interface ReadinessEstimate {
  ready_pct: number;
  satisfied: number;
  total: number;
  remaining_critical_days: number;
  projected_ready_date: string | null;
  blocked_count: number;
  note: string;
}

export interface CarryoverEntry {
  task_code: string;
  from_version: number;
  from_plan_id: string;
  note: string;
}

export class CycleError extends Error {
  constructor(message = "cyclic dependency detected in onboarding plan") {
    super(message);
    this.name = "CycleError";
  }
}

// ---------------------------------------------------------------------------
// Hashing (deterministic, sync; binding approval to exact task definitions)
// ---------------------------------------------------------------------------

function fnv1a(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable hash of canonical task definitions — same defs always hash equal. */
export function planHash(defs: TaskDef[]): string {
  const canonical = defs
    .map((d) =>
      JSON.stringify({
        code: d.task_code,
        title: d.title,
        type: d.task_type,
        owner: d.owner_role,
        required: d.required,
        non_waivable: d.non_waivable,
        deps: [...d.depends_on].sort(),
        days: d.duration_days,
        why: d.why_evidence,
        evreq: d.evidence_requirements,
      })
    )
    .sort()
    .join("\u0001");
  const h1 = fnv1a(canonical).toString(16).padStart(8, "0");
  const h2 = fnv1a(canonical, 0x811c9dc5 ^ canonical.length).toString(16).padStart(8, "0");
  return `${h1}${h2}`;
}

/** Attempt hash for execution dedup: same actor+payload on same task+action. */
export function attemptHash(planId: string, taskCode: string, action: string, payload: unknown): string {
  const canonical = JSON.stringify({ planId, taskCode, action, payload });
  const h1 = fnv1a(canonical).toString(16).padStart(8, "0");
  const h2 = fnv1a(canonical, 0xdeadbeef).toString(16).padStart(8, "0");
  return `${h1}${h2}`;
}

// ---------------------------------------------------------------------------
// DAG validation + topological scheduling
// ---------------------------------------------------------------------------

export function validateDag(defs: TaskDef[]): void {
  const ids = new Set(defs.map((d) => d.task_code));
  for (const d of defs) {
    for (const dep of d.depends_on) {
      if (!ids.has(dep)) throw new Error(`task ${d.task_code} depends on unknown task ${dep}`);
    }
  }
  const indegree = new Map(defs.map((d) => [d.task_code, d.depends_on.length]));
  const adj = new Map<string, string[]>();
  for (const d of defs) {
    for (const dep of d.depends_on) adj.set(dep, [...(adj.get(dep) ?? []), d.task_code]);
  }
  const queue = defs.filter((d) => (indegree.get(d.task_code) ?? 0) === 0).map((d) => d.task_code);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const child of adj.get(id) ?? []) {
      indegree.set(child, (indegree.get(child) ?? 0) - 1);
      if ((indegree.get(child) ?? 0) === 0) queue.push(child);
    }
  }
  if (order.length !== defs.length) throw new CycleError();
}

const DAY_MS = 24 * 60 * 60 * 1000;
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function topologicalOrder(defs: TaskDef[]): string[] {
  validateDag(defs);
  const indegree = new Map(defs.map((d) => [d.task_code, d.depends_on.length]));
  const adj = new Map<string, string[]>();
  for (const d of defs) {
    for (const dep of d.depends_on) adj.set(dep, [...(adj.get(dep) ?? []), d.task_code]);
  }
  const queue = defs.filter((d) => (indegree.get(d.task_code) ?? 0) === 0).map((d) => d.task_code);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const child of adj.get(id) ?? []) {
      indegree.set(child, (indegree.get(child) ?? 0) - 1);
      if ((indegree.get(child) ?? 0) === 0) queue.push(child);
    }
  }
  return order;
}

/** Satisfied = done or waived. Used for both state derivation and critical path. */
export function satisfiedSet(tasks: Pick<PlanTask, "task_code" | "state">[]): Set<string> {
  return new Set(tasks.filter((t) => t.state === "done" || t.state === "waived").map((t) => t.task_code));
}

export function hasOpenBlocker(blockers: Blocker[]): boolean {
  return blockers.some((b) => b.status === "open");
}

/**
 * Recompute execution state + dates from stored facts (definition + state).
 * Dates are null for blocked/failed tasks and cascade downstream.
 */
export function deriveStates(defs: TaskDef[], facts: {
  done?: string[];
  waived?: string[];
  failed?: string[];
  blockers?: Record<string, Blocker[]>;
  approved?: boolean;
  startDate?: string;
}): PlanTask[] {
  validateDag(defs);
  const done = new Set(facts.done ?? []);
  const waived = new Set(facts.waived ?? []);
  const failed = new Set(facts.failed ?? []);
  const approved = facts.approved ?? false;
  const start = facts.startDate ? new Date(facts.startDate) : new Date();

  const order = topologicalOrder(defs);
  const defById = new Map(defs.map((d) => [d.task_code, d]));

  const level = new Map<string, number>();
  for (const id of order) {
    const d = defById.get(id)!;
    level.set(id, d.depends_on.reduce((m, dep) => Math.max(m, (level.get(dep) ?? 0) + 1), 0));
  }

  const endBy = new Map<string, Date | null>();
  const out = new Map<string, PlanTask>();
  for (const id of order) {
    const d = defById.get(id)!;
    const blockers = facts.blockers?.[id] ?? [];
    const open = hasOpenBlocker(blockers);
    const depStates = new Map(d.depends_on.map((dep) => [dep, out.get(dep)?.state ?? "missing"]));
    const unmet = d.depends_on.filter((dep) => !done.has(dep) && !waived.has(dep));
    const cascadingBlock = d.depends_on.some((dep) => {
      const s = depStates.get(dep);
      return s === "blocked" || s === "failed";
    });

    let state: TaskState = "pending";
    if (done.has(id)) state = "done";
    else if (waived.has(id)) state = "waived";
    else if (failed.has(id)) state = "failed";
    else if (!approved) state = "pending";
    else if (open) state = "blocked";
    else if (cascadingBlock) state = "blocked";
    else if (unmet.length > 0) state = "pending"; // queued: approved but deps not yet satisfied
    else state = "ready";

    let startDate: Date | null;
    let endDate: Date | null;
    if (state === "blocked" || state === "failed") {
      startDate = null;
      endDate = null;
    } else {
      const prereqEnds = d.depends_on
        .map((dep) => endBy.get(dep))
        .filter((e): e is Date => e instanceof Date);
      const base = prereqEnds.length > 0 ? new Date(Math.max(...prereqEnds.map((e) => e.getTime()))) : new Date(start);
      startDate = base;
      endDate = addDays(base, d.duration_days);
    }
    endBy.set(id, endDate);

    out.set(id, {
      ...d,
      state,
      start_date: startDate ? startDate.toISOString() : null,
      due_date: endDate ? endDate.toISOString() : null,
      topological_level: level.get(id) ?? 0,
      blocked_reasons: unmet,
      blockers,
      waiver: null,
      completion_record: null,
      adaptation: null,
    });
  }
  return [...out.values()];
}

/** Apply stored execution records onto derived states (single source of truth). */
export function materialize(tasks: PlanTask[], records: {
  completion?: Record<string, CompletionRecord>;
  waiver?: Record<string, Waiver>;
  adaptation?: Record<string, Adaptation>;
  blockers?: Record<string, Blocker[]>;
}): PlanTask[] {
  return tasks.map((t) => ({
    ...t,
    state: records.waiver?.[t.task_code]
      ? "waived"
      : records.completion?.[t.task_code]
        ? "done"
        : records.adaptation?.[t.task_code]
          ? "failed"
          : t.state,
    blockers: records.blockers?.[t.task_code] ?? t.blockers,
    waiver: records.waiver?.[t.task_code] ?? t.waiver,
    completion_record: records.completion?.[t.task_code] ?? t.completion_record,
    adaptation: records.adaptation?.[t.task_code] ?? t.adaptation,
  }));
}

// ---------------------------------------------------------------------------
// Critical path + honest readiness estimate
// ---------------------------------------------------------------------------

/** Longest remaining chain (by duration) among tasks that are not satisfied. */
export function criticalPath(defs: TaskDef[], satisfied: Set<string>): { tasks: string[]; total_days: number } {
  validateDag(defs);
  const defById = new Map(defs.map((d) => [d.task_code, d]));
  const adj = new Map<string, string[]>();
  for (const d of defs) for (const dep of d.depends_on) adj.set(dep, [...(adj.get(dep) ?? []), d.task_code]);

  const memo = new Map<string, { tasks: string[]; days: number }>();
  const chainFrom = (id: string): { tasks: string[]; days: number } => {
    const known = memo.get(id);
    if (known) return known;
    const d = defById.get(id)!;
    let best: { tasks: string[]; days: number } = { tasks: [], days: 0 };
    for (const child of adj.get(id) ?? []) {
      const c = chainFrom(child);
      if (c.days > best.days) best = c;
    }
    const res = { tasks: [id, ...best.tasks], days: d.duration_days + best.days };
    memo.set(id, res);
    return res;
  };

  let best: { tasks: string[]; days: number } = { tasks: [], days: 0 };
  for (const d of defs) {
    if (satisfied.has(d.task_code)) continue;
    const c = chainFrom(d.task_code);
    if (c.days > best.days) best = c;
  }
  return { tasks: best.tasks, total_days: best.days };
}

/** Honest readiness: satisfied/total + remaining critical path from today. */
export function estimateReadiness(defs: TaskDef[], tasks: PlanTask[], startDate: string, now: string): ReadinessEstimate {
  const satisfied = satisfiedSet(tasks);
  const total = defs.length;
  const readyPct = total === 0 ? 0 : Math.round((satisfied.size / total) * 1000) / 10;
  const { total_days } = criticalPath(defs, satisfied);
  const blockedCount = tasks.filter((t) => t.state === "blocked" || t.state === "failed").length;
  const projected = total_days === 0 ? null : addDays(new Date(now), total_days).toISOString();
  const note =
    blockedCount > 0
      ? "Estimated readiness — projected earliest completion if every blocker clears today; blocked work makes this provisional, not a guarantee."
      : "Estimated readiness — projected earliest completion from today's date; an estimate, not a guarantee.";
  return {
    ready_pct: readyPct,
    satisfied: satisfied.size,
    total,
    remaining_critical_days: total_days,
    projected_ready_date: projected,
    blocked_count: blockedCount,
    note,
  };
}

// ---------------------------------------------------------------------------
// Authorization matrix — strict per-owner-role, no broad HR to service owners
// ---------------------------------------------------------------------------

export function canActOnTask(actor: { id: string; role: string; org_id: string | null }, taskOwner: OwnerRole, twin: { id: string; manager_id: string | null; org_id: string | null }): { ok: boolean; error?: string } {
  if (actor.org_id !== twin.org_id) return { ok: false, error: "Cross-org task access is forbidden." };
  switch (taskOwner) {
    case "employee":
      return actor.id === twin.id
        ? { ok: true }
        : { ok: false, error: "Only the employee themselves may complete this task." };
    case "manager":
      return actor.role === "manager" && actor.id === twin.manager_id
        ? { ok: true }
        : { ok: false, error: "Only the employee's direct manager may act on this task." };
    case "hr":
      return actor.role === "hr_executive" || actor.role === "hr_partner"
        ? { ok: true }
        : { ok: false, error: "Only HR may act on this task." };
    case "it_security":
      return actor.role === "it_security"
        ? { ok: true }
        : { ok: false, error: "Only the IT security service owner may act on this task — HR has no access to service-owner tasks." };
    default:
      return { ok: false, error: "Unknown owner role." };
  }
}

export function canWaive(actor: { id: string; role: string }, twin: { manager_id: string | null }, taskNonWaivable: boolean, taskOwner: OwnerRole): { ok: boolean; error?: string } {
  if (taskNonWaivable) {
    return actor.role === "hr_executive"
      ? { ok: true }
      : { ok: false, error: "Non-waivable tasks may only be waived by an HR Executive with a policy basis." };
  }
  if (actor.role === "manager" && actor.id === twin.manager_id) return { ok: true };
  if (actor.role === "hr_executive" || actor.role === "hr_partner") return { ok: true };
  return { ok: false, error: "Waivers require the employee's manager or an HR role." };
}

export function canAdapt(actor: { id: string; role: string }, twin: { manager_id: string | null }): { ok: boolean; error?: string } {
  if (actor.role === "manager" && actor.id === twin.manager_id) return { ok: true };
  if (actor.role === "hr_executive" || actor.role === "hr_partner") return { ok: true };
  return { ok: false, error: "Plan adaptation requires the employee's manager or an HR role." };
}

// ---------------------------------------------------------------------------
// Completion checks — pure; every gate the backend must enforce
// ---------------------------------------------------------------------------

export interface CompletionCheckInput {
  planStatus: PlanStatus;
  task: PlanTask;
  actor: { id: string; role: string; org_id: string | null };
  twin: { id: string; manager_id: string | null; org_id: string | null };
  evidence: { kind: "note" | "assessment_id"; label: string; value: string }[];
}

export function validateCompletion(i: CompletionCheckInput): { ok: boolean; code?: string; error?: string } {
  if (i.planStatus !== "approved") {
    return { ok: false, code: "plan_pending", error: "The plan must be approved by the Manager and HR Executive before tasks can be completed." };
  }
  const auth = canActOnTask(i.actor, i.task.owner_role, i.twin);
  if (!auth.ok) return { ok: false, code: "forbidden", error: auth.error };
  if (i.task.state === "done") {
    return { ok: false, code: "double_submission", error: `"${i.task.title}" is already complete — double submission rejected.` };
  }
  if (i.task.state === "waived") {
    return { ok: false, code: "already_waived", error: `"${i.task.title}" was waived — nothing to complete.` };
  }
  if (i.task.state === "failed") {
    return { ok: false, code: "task_failed", error: `"${i.task.title}" is failed/adopted out — regenerate the plan.` };
  }
  const open = i.task.blockers.filter((b) => b.status === "open");
  if (open.length > 0) {
    return { ok: false, code: "blocked", error: `Cannot complete — open blocker(s): ${open.map((b) => b.note).join("; ")}.` };
  }
  if (i.task.state === "blocked") {
    const why = i.task.blocked_reasons.length > 0 ? `Prerequisites not satisfied: ${i.task.blocked_reasons.join(", ")}` : "blocked by an upstream task or blocker";
    return { ok: false, code: "unmet_prerequisite", error: `Cannot complete — ${why}.` };
  }
  if (i.task.blocked_reasons.length > 0) {
    return { ok: false, code: "unmet_prerequisite", error: `Prerequisites not satisfied: ${i.task.blocked_reasons.join(", ")}.` };
  }
  if (i.task.state === "pending") {
    return { ok: false, code: "plan_pending", error: "The plan is not active yet." };
  }
  const missing = (i.task.evidence_requirements ?? []).filter((r) => r.required && !i.evidence.some((e) => e.kind === r.kind && String(e.value ?? "").trim().length > 0));
  if (missing.length > 0) {
    return { ok: false, code: "missing_evidence", error: `Evidence required before completion: ${missing.map((m) => m.label).join(", ")}.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Waiver application (authorized actor/reason/policy basis/audit)
// ---------------------------------------------------------------------------

export interface WaiverInput {
  by_twin_id: string;
  by_name: string;
  reason: string;
  policy_basis: { doc_code: string; version: number | null } | null;
  at: string;
}

export function applyWaiver(task: PlanTask, waiver: WaiverInput): PlanTask {
  return {
    ...task,
    state: "waived",
    waiver: { ...waiver },
    completion_record: null,
  };
}

// ---------------------------------------------------------------------------
// Adaptation: learning -> verification, and failed verification reopens gap
// ---------------------------------------------------------------------------

export interface AdaptationInput {
  actor_twin_id: string;
  reason: string;
  source_evidence: WhyEvidence["source_evidence"];
  at: string;
}

/** Replace a learning task with a verification task (new assessment evidence). */
export function adaptLearningToVerification(defs: TaskDef[], learningTask: TaskDef, verifyDef: TaskDef, input: AdaptationInput): { defs: TaskDef[]; adaptation: Adaptation } {
  const adaptation: Adaptation = {
    kind: "replaced",
    replaced_by: verifyDef.task_code,
    reason: input.reason,
    source_evidence: input.source_evidence,
    at: input.at,
    actor_twin_id: input.actor_twin_id,
  };
  const rest = defs.filter((d) => d.task_code !== learningTask.task_code);
  return { defs: [...rest, verifyDef], adaptation };
}

/** Mark a verification task failed: the gap reopens and the plan must revise. */
export function failVerification(task: PlanTask, input: AdaptationInput): { task: PlanTask; adaptation: Adaptation } {
  const adaptation: Adaptation = {
    kind: "reopened_gap",
    reason: input.reason,
    source_evidence: input.source_evidence,
    at: input.at,
    actor_twin_id: input.actor_twin_id,
  };
  return { task: { ...task, state: "failed", adaptation }, adaptation };
}

// ---------------------------------------------------------------------------
// Plan builder — deterministic DAG from the approved role relationship
// ---------------------------------------------------------------------------

export interface PlanBuildInput {
  role: {
    title: string;
    required_skills: { skill: string; target_proficiency: number }[];
    future_skills: { skill: string; target_proficiency: number }[];
    seniority_level: number;
  };
  verified_skills: { name: string; proficiency: number }[];
  policy_docs: { doc_code: string; title: string }[];
  reopened_skills?: string[]; // skills whose verification failed — learn again
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function skillProficiency(verified: { name: string; proficiency: number }[], skill: string): number {
  const hit = verified.find((v) => v.name.toLowerCase() === skill.toLowerCase());
  return hit?.proficiency ?? 0;
}

/**
 * Deterministic plan: core provisioning/policy/admin + skill-gap learning tasks
 * + one verification task on the first required-skill gap + survey.
 */
export function buildPlanDefs(input: PlanBuildInput): TaskDef[] {
  const required = (input.role.required_skills ?? []).slice(0, 3);
  const future = (input.role.future_skills ?? []).slice(0, 2);
  const reopened = new Set((input.reopened_skills ?? []).map((s) => s.toLowerCase()));

  const gaps = required.filter(
    (s) => reopened.has(s.skill.toLowerCase()) || skillProficiency(input.verified_skills, s.skill) < s.target_proficiency
  );
  const futureGaps = future.filter((s) => skillProficiency(input.verified_skills, s.skill) < s.target_proficiency);

  const secPolicy = input.policy_docs.find((p) => p.doc_code === "POL-SEC");
  const defs: TaskDef[] = [
    {
      task_code: "it_provisioning",
      title: "IT & Laptop Provisioning",
      task_type: "provisioning",
      owner_role: "it_security",
      required: true,
      non_waivable: true,
      depends_on: [],
      duration_days: 1,
      why_evidence: {
        reason: "Company-issued equipment is mandatory before any system access is granted.",
        source_evidence: [{ source_type: "policy", fact: secPolicy ? `POL-SEC ${secPolicy.title} — work on company-issued devices only.` : "Equipment & Security policy — company-issued devices only." }],
      },
      evidence_requirements: [{ kind: "note", label: "Hardware & asset tag", required: true }],
    },
    {
      task_code: "security_training",
      title: "Security & Compliance Training",
      task_type: "policy",
      owner_role: "employee",
      required: true,
      non_waivable: true,
      depends_on: [],
      duration_days: 1,
      why_evidence: {
        reason: "Annual security training is required for continued system access.",
        source_evidence: [{ source_type: "policy", fact: secPolicy ? `POL-SEC ${secPolicy.title} — annual training required.` : "Equipment & Security policy — annual training required." }],
      },
      evidence_requirements: [{ kind: "note", label: "Training completion reference", required: true }],
    },
    {
      task_code: "payroll",
      title: "Direct Deposit & Payroll Setup",
      task_type: "onboarding_admin",
      owner_role: "hr",
      required: true,
      non_waivable: true,
      depends_on: [],
      duration_days: 0.5,
      why_evidence: {
        reason: "Payroll setup is handled by HR before the first pay run.",
        source_evidence: [{ source_type: "onboarding_admin", fact: "Standard onboarding payroll step." }],
      },
      evidence_requirements: [{ kind: "note", label: "Payroll reference (HR)", required: true }],
    },
    {
      task_code: "access_sso",
      title: "System Access & SSO Enrollment",
      task_type: "access",
      owner_role: "it_security",
      required: true,
      non_waivable: true,
      depends_on: ["it_provisioning", "security_training"],
      duration_days: 0.5,
      why_evidence: {
        reason: "SSO and tool access can only be provisioned after hardware and security training are complete.",
        source_evidence: [{ source_type: "policy", fact: "POL-SEC — MFA mandatory on all accounts; access requires completed security training." }],
      },
      evidence_requirements: [{ kind: "note", label: "MFA / SSO enrollment reference", required: true }],
    },
    {
      task_code: "team_intro",
      title: "Team Introduction & Codebase Walkthrough",
      task_type: "onboarding_admin",
      owner_role: "manager",
      required: true,
      non_waivable: false,
      depends_on: ["access_sso"],
      duration_days: 1,
      why_evidence: {
        reason: "Manager-led introduction and codebase walkthrough require system access first.",
        source_evidence: [{ source_type: "manager", fact: "Standard team integration step after access." }],
      },
      evidence_requirements: [{ kind: "note", label: "Walkthrough held (manager)", required: true }],
    },
  ];

  const firstGap = gaps[0];
  for (const s of gaps) {
    const isReopened = reopened.has(s.skill.toLowerCase());
    const code = isReopened ? `learn_${slug(s.skill)}_reopen` : `learn_${slug(s.skill)}`;
    defs.push({
      task_code: code,
      title: isReopened ? `Re-learning: ${s.skill} (verified gap re-opened)` : `First contribution using ${s.skill}`,
      task_type: "learning",
      owner_role: "employee",
      required: true,
      non_waivable: false,
      depends_on: ["team_intro"],
      duration_days: 1,
      why_evidence: {
        reason: isReopened
          ? `A prior verification attempt did not confirm ${s.skill} at target ${s.target_proficiency}; the gap is re-opened for learning.`
          : `Role requires ${s.skill} at ${s.target_proficiency}; current verified proficiency is ${skillProficiency(input.verified_skills, s.skill)}.`,
        source_evidence: [
          { source_type: "role_fit", fact: `Gap on ${s.skill} vs approved role ${input.role.title} (target ${s.target_proficiency}).` },
          ...(isReopened ? [{ source_type: "verification", fact: `Previous verification of ${s.skill} failed — reason preserved on the superseded task.` }] : []),
        ],
      },
      evidence_requirements: [{ kind: "note", label: `Contribution evidence: ${s.skill}`, required: true }],
    });
    // Verification task on the FIRST gap only.
    if (firstGap && s.skill.toLowerCase() === firstGap.skill.toLowerCase()) {
      defs.push({
        task_code: `verify_${slug(s.skill)}`,
        title: `Verification: ${s.skill} mastery assessment`,
        task_type: "verification",
        owner_role: "employee",
        required: true,
        non_waivable: false,
        depends_on: [code],
        duration_days: 0.5,
        why_evidence: {
          reason: `New assessment evidence replaces further learning for ${s.skill}: verify mastery at target ${s.target_proficiency}.`,
          source_evidence: [{ source_type: "assessment", fact: `Assessment evidence supersedes the learning-only path for ${s.skill}.` }],
        },
        evidence_requirements: [{ kind: "assessment_id", label: "Assessment evidence id", required: true }],
      });
    }
  }
  for (const s of futureGaps) {
    const anchor = gaps[0] ? `learn_${slug(gaps[0].skill)}` : "team_intro";
    defs.push({
      task_code: `future_${slug(s.skill)}`,
      title: `Upskilling plan: ${s.skill}`,
      task_type: "learning",
      owner_role: "employee",
      required: true,
      non_waivable: false,
      depends_on: [anchor],
      duration_days: 1,
      why_evidence: {
        reason: `Future skill ${s.skill} is part of the role's growth path; current verified proficiency ${skillProficiency(input.verified_skills, s.skill)} is below target ${s.target_proficiency}.`,
        source_evidence: [{ source_type: "role_fit", fact: `Future-fit gap on ${s.skill} vs approved role ${input.role.title}.` }],
      },
      evidence_requirements: [{ kind: "note", label: `Upskilling evidence: ${s.skill}`, required: true }],
    });
  }
  defs.push({
    task_code: "survey",
    title: "Onboarding Feedback Survey",
    task_type: "onboarding_admin",
    owner_role: "employee",
    required: true,
    non_waivable: false,
    depends_on: [gaps.length > 0 ? `learn_${slug(gaps[0].skill)}` : "team_intro"],
    duration_days: 0.5,
    why_evidence: {
      reason: "Feedback survey closes the loop after the core journey is underway.",
      source_evidence: [{ source_type: "onboarding_admin", fact: "Standard closing step." }],
    },
    evidence_requirements: [{ kind: "note", label: "Survey submitted", required: true }],
  });
  return defs;
}

// ---------------------------------------------------------------------------
// Carryover on regeneration: preserve valid completed work with a mapping
// ---------------------------------------------------------------------------

export function buildCarryover(prevTasks: PlanTask[], newDefs: TaskDef[], fromPlanId: string, fromVersion: number): { tasks: PlanTask[]; entries: CarryoverEntry[] } {
  const byCode = new Map(prevTasks.map((t) => [t.task_code, t]));
  const entries: CarryoverEntry[] = [];
  const tasks: PlanTask[] = newDefs.map((d) => {
    const prev = byCode.get(d.task_code);
    const fresh: PlanTask = { ...d, state: "pending", start_date: null, due_date: null, topological_level: 0, blocked_reasons: [], blockers: [], waiver: null, completion_record: null, adaptation: null };
    if (!prev) return fresh;
    const defSame =
      prev.title === d.title &&
      prev.task_type === d.task_type &&
      prev.owner_role === d.owner_role &&
      prev.required === d.required &&
      prev.non_waivable === d.non_waivable &&
      prev.duration_days === d.duration_days &&
      JSON.stringify([...prev.depends_on].sort()) === JSON.stringify([...d.depends_on].sort());
    if (!defSame) return fresh;
    if (prev.state === "done" && prev.completion_record) {
      entries.push({ task_code: d.task_code, from_version: fromVersion, from_plan_id: fromPlanId, note: "Completed work preserved on regeneration." });
      return { ...d, state: "done", start_date: prev.start_date, due_date: prev.due_date, topological_level: 0, blocked_reasons: [], blockers: [], waiver: prev.waiver, completion_record: prev.completion_record, adaptation: prev.adaptation };
    }
    if (prev.state === "waived" && prev.waiver) {
      entries.push({ task_code: d.task_code, from_version: fromVersion, from_plan_id: fromPlanId, note: "Waiver preserved on regeneration." });
      return { ...d, state: "waived", start_date: prev.start_date, due_date: prev.due_date, topological_level: 0, blocked_reasons: [], blockers: [], waiver: prev.waiver, completion_record: null, adaptation: prev.adaptation };
    }
    return fresh;
  });
  return { tasks, entries };
}
