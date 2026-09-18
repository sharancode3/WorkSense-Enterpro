// ---------------------------------------------------------------------------
// WorkSense onboarding queue engine (Phase 6).
// Derives role-scoped operational queues from the canonical plan/task rows:
//  - employee   -> their own journey's next action + what they are waiting on
//  - manager    -> their direct reports' journeys (approvals + orientation)
//  - hr         -> every journey in the org, with stalled/overdue filters
//  - it_security-> provisioning & access tasks across all active journeys
// Stalled = an open blocker or an actionable task overdue beyond STALL_DAYS.
// Overdue  = an actionable task (ready/in_progress) whose due date has passed.
// No plan inputs are modified here — this is a read-only projection.
// ---------------------------------------------------------------------------

export type QueueOwnerRole = "employee" | "manager" | "hr" | "it_security";

export const STALL_DAYS = 7;

export interface QueueTaskRef {
  task_code: string;
  title: string;
  task_type: string;
  owner_role: string;
  state: string;
  due_date: string | null;
  topological_level: number;
  plan_id: string;
  twin_id: string;
}

export interface QueueJourney {
  twin_id: string;
  employee_name: string;
  job_title: string | null;
  department: string | null;
  manager_id: string | null;
  plan_id: string;
  version: number;
  status: string;
  start_date: string;
  readiness_pct: number;
  projected_ready_date: string | null;
  provisional: boolean;
  blocked_count: number;
  /** Owned-task completion (done+waived), distinct from readiness. */
  completed_tasks: number;
  total_tasks: number;
  /** Mandatory readiness gates (access / compliance / capability). */
  gates: { key: string; label: string; pct: number }[];
  pending_manager_approval: boolean;
  pending_hr_approval: boolean;
  overdue: boolean;
  overdue_count: number;
  stalled: boolean;
  stall_reasons: string[];
  /** Tasks the viewing role is authorized to act on. */
  viewer_actions: QueueTaskRef[];
  /** Tasks this journey's employee is waiting on (owned by others, unmet deps). */
  waiting_on: QueueTaskRef[];
}

export interface OnboardingQueueResult {
  ok: true;
  role: QueueOwnerRole;
  journeys: QueueJourney[];
  /** IT-only: provisioning/access tasks across active journeys. */
  provisioning: QueueTaskRef[];
  filters: { all: number; pending_approval: number; overdue: number; stalled: number };
}

interface JourneyInput {
  plan: {
    id: string;
    twin_id: string;
    version: number;
    status: string;
    start_date: string;
    readiness: { ready_pct?: number; projected_ready_date?: string | null; provisional?: boolean; blocked_count?: number; satisfied?: number; total?: number; dimensions?: { key: string; label: string; pct: number }[] };
    manager_approval: { at?: string } | null;
    hr_approval: { at?: string } | null;
  };
  employee: { id: string; name: string; job_title: string | null; department: string | null; manager_id: string | null };
  tasks: {
    task_code: string;
    title: string;
    task_type: string;
    owner_role: string;
    state: string;
    due_date: string | null;
    topological_level: number;
    depends_on: string[];
    blockers: { status: string; at: string }[];
  }[];
}

function isActionable(state: string): boolean {
  return state === "ready" || state === "in_progress" || state === "pending";
}

function overdueDays(due: string | null, now: string): number {
  if (!due) return 0;
  const diff = new Date(now).getTime() - new Date(due).getTime();
  return Math.floor(diff / 86400000);
}

export function buildOnboardingQueue(input: {
  role: QueueOwnerRole;
  journeys: JourneyInput[];
  now: string;
}): OnboardingQueueResult {
  const now = input.now;
  const journeys: QueueJourney[] = input.journeys.map((j) => {
    const actionable = j.tasks.filter((t) => isActionable(t.state));
    const overdueTasks = actionable.filter((t) => t.due_date && overdueDays(t.due_date, now) > 0);
    const openBlockers = j.tasks.filter((t) => t.blockers.some((b) => b.status === "open"));
    const stalledByBlocker = openBlockers.length > 0;
    const stalledByOverdue = overdueTasks.some((t) => overdueDays(t.due_date, now) > STALL_DAYS);
    const stalled = stalledByBlocker || stalledByOverdue;
    const stallReasons: string[] = [];
    if (stalledByBlocker) stallReasons.push(`${openBlockers.length} open blocker(s)`);
    if (stalledByOverdue) {
      const worst = overdueTasks.reduce((m, t) => Math.max(m, overdueDays(t.due_date, now)), 0);
      stallReasons.push(`actionable task overdue ${worst}d`);
    }

    const doneCodes = new Set(j.tasks.filter((t) => t.state === "done" || t.state === "waived").map((t) => t.task_code));
    const readiness = j.plan.readiness ?? {};
    // Waiting on: tasks owned by OTHERS that gate the employee's own remaining tasks.
    const employeeRemaining = j.tasks.filter((t) => t.owner_role === "employee" && t.state !== "done" && t.state !== "waived");
    const needed = new Set(employeeRemaining.flatMap((t) => t.depends_on ?? []));
    const waitingOn = j.tasks
      .filter((t) => needed.has(t.task_code) && !doneCodes.has(t.task_code))
      .map((t) => toRef(j, t));

    const viewerActions = j.tasks
      .filter((t) => {
        if (t.state === "done" || t.state === "waived") return false;
        // viewer_actions = tasks the viewer can genuinely DRIVE (complete or
        // execute per the strict owner matrix). Waive/adapt remain available
        // in the plan view with their own authorization checks, but a queue
        // that lists tasks the viewer cannot complete would over-expose them.
        if (input.role === "employee") return t.owner_role === "employee";
        if (input.role === "manager") return t.owner_role === "manager";
        if (input.role === "hr") return t.owner_role === "hr";
        // it_security: provisioning + access only
        return t.task_type === "provisioning" || t.task_type === "access";
      })
      .map((t) => toRef(j, t));

    return {
      twin_id: j.employee.id,
      employee_name: j.employee.name,
      job_title: j.employee.job_title,
      department: j.employee.department ?? null,
      manager_id: j.employee.manager_id,
      plan_id: j.plan.id,
      version: j.plan.version,
      status: j.plan.status,
      start_date: j.plan.start_date,
      readiness_pct: readiness.ready_pct ?? 0,
      projected_ready_date: readiness.projected_ready_date ?? null,
      provisional: readiness.provisional ?? false,
      blocked_count: readiness.blocked_count ?? 0,
      completed_tasks: readiness.satisfied ?? j.tasks.filter((t) => t.state === "done" || t.state === "waived").length,
      total_tasks: readiness.total ?? j.tasks.length,
      gates: Array.isArray(readiness.dimensions) ? readiness.dimensions : [],
      pending_manager_approval: j.plan.status === "pending_approval" && !j.plan.manager_approval?.at,
      pending_hr_approval: j.plan.status === "pending_approval" && !j.plan.hr_approval?.at,
      overdue: overdueTasks.length > 0,
      overdue_count: overdueTasks.length,
      stalled,
      stall_reasons: stallReasons,
      viewer_actions: viewerActions,
      waiting_on: waitingOn,
    };
  });

  const active = (j: QueueJourney) => j.status === "approved" || j.status === "pending_approval";

  const provisioning: QueueTaskRef[] =
    input.role === "it_security"
      ? journeys
          .filter(active)
          .flatMap((j) => j.viewer_actions.filter((t) => t.task_type === "provisioning" || t.task_type === "access"))
      : [];

  const sorted = [...journeys].sort((a, b) => {
    if (a.stalled !== b.stalled) return a.stalled ? -1 : 1;
    if (a.pending_manager_approval !== b.pending_manager_approval) return a.pending_manager_approval ? -1 : 1;
    return a.employee_name.localeCompare(b.employee_name);
  });

  return {
    ok: true,
    role: input.role,
    journeys: sorted,
    provisioning,
    filters: {
      all: sorted.length,
      pending_approval: sorted.filter((j) => j.pending_manager_approval || j.pending_hr_approval).length,
      overdue: sorted.filter((j) => j.overdue).length,
      stalled: sorted.filter((j) => j.stalled).length,
    },
  };
}

const toRef = (j: JourneyInput, t: JourneyInput["tasks"][number]): QueueTaskRef => ({
  task_code: t.task_code,
  title: t.title,
  task_type: t.task_type,
  owner_role: t.owner_role,
  state: t.state,
  due_date: t.due_date,
  topological_level: t.topological_level,
  plan_id: j.plan.id,
  twin_id: j.employee.id,
});
