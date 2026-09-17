// ---------------------------------------------------------------------------
// WorkSense Adaptive Onboarding engine — fully deterministic, zero LLM.
//  - Bloom-style waiver rule (proficiency >= target -> waive)
//  - Plan quality guard (non-waivable tasks)
//  - Kahn's topological scheduler + date assignment
//  - Blocker-aware date recomputation
// ---------------------------------------------------------------------------

export interface TaskInput {
  id: string;
  title: string;
  depends_on?: string[];
  skill?: string;
  target_proficiency?: number;
  non_waivable?: boolean;
  duration_days?: number;
}

export interface ScheduledTask extends TaskInput {
  depends_on: string[];
  duration_days: number;
  waived: boolean;
  status: "waived" | "pending" | "done" | "blocked";
  start_date: string | null;
  end_date: string | null;
  topological_level: number;
  blocked?: { note: string; reported_by: string; at: string } | null;
}

export interface Blocker {
  taskId: string;
  note: string;
  reported_by: string;
  at: string;
}

export class CycleError extends Error {
  constructor(message = "cyclic dependency detected in onboarding plan") {
    super(message);
    this.name = "CycleError";
  }
}

/** Non-negotiable tasks: never waived or deleted, regardless of skill match. */
export const NON_WAIVABLE_TASK_IDS = new Set(["security", "compliance_signoff", "payroll"]);

export function applyWaivers(
  tasks: TaskInput[],
  skills: { name: string; proficiency: number }[]
): { tasks: TaskInput[]; waived: string[]; required: string[] } {
  const skillMap = new Map(skills.map((s) => [s.name.toLowerCase(), s.proficiency]));
  const waived: string[] = [];
  const required: string[] = [];
  const out = tasks.map((t) => {
    if (t.non_waivable || NON_WAIVABLE_TASK_IDS.has(t.id)) {
      required.push(t.id);
      return t;
    }
    const prof = t.skill ? skillMap.get(t.skill.toLowerCase()) : undefined;
    if (prof !== undefined && prof >= (t.target_proficiency ?? 3)) {
      waived.push(t.id);
      return t;
    }
    required.push(t.id);
    return t;
  });
  return { tasks: out, waived, required };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/**
 * Kahn's topological scheduler, exactly as specified:
 * compute in-degree, queue zero-in-degree tasks, pop -> append -> decrement
 * dependents -> enqueue newly-zero. Any task not scheduled => cyclic error.
 * Start date = max(end of prerequisites) or the onboarding start date.
 */
export function schedulePlan(params: {
  tasks: TaskInput[];
  skills: { name: string; proficiency: number }[];
  startDate: string;
  blocked?: Blocker;
  doneTaskIds?: string[];
}): ScheduledTask[] {
  const { tasks: input, waived: waivedIds } = applyWaivers(params.tasks, params.skills);
  const ids = new Set(input.map((t) => t.id));
  for (const t of input) {
    for (const d of t.depends_on ?? []) {
      if (!ids.has(d)) throw new Error(`task ${t.id} depends on unknown task ${d}`);
    }
  }

  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of input) {
    indegree.set(t.id, (t.depends_on ?? []).length);
    for (const d of t.depends_on ?? []) {
      adj.set(d, [...(adj.get(d) ?? []), t.id]);
    }
  }

  const queue: string[] = [];
  for (const t of input) if ((indegree.get(t.id) ?? 0) === 0) queue.push(t.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dep of adj.get(id) ?? []) {
      indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
      if ((indegree.get(dep) ?? 0) === 0) queue.push(dep);
    }
  }
  if (order.length !== input.length) {
    throw new CycleError();
  }

  // Topological level (wave) per task for the DAG view.
  const level = new Map<string, number>();
  for (const id of order) {
    const t = input.find((x) => x.id === id)!;
    level.set(id, (t.depends_on ?? []).reduce((m, d) => Math.max(m, (level.get(d) ?? 0) + 1), 0));
  }

  const taskById = new Map(input.map((t) => [t.id, t]));
  const start = new Date(params.startDate);
  const endBy = new Map<string, Date | null>();
  const done = new Set(params.doneTaskIds ?? []);
  const scheduled: ScheduledTask[] = [];

  for (const id of order) {
    const t = taskById.get(id)!;
    const blocked = params.blocked?.taskId === id ? params.blocked : null;
    const blockedPrereq = (t.depends_on ?? []).find((d) => endBy.get(d) === null);

    let startDate: Date | null;
    let endDate: Date | null;
    if (blocked) {
      startDate = null;
      endDate = null;
    } else if (blockedPrereq) {
      // Waiting on a blocked prerequisite — downstream dates recompute to null.
      startDate = null;
      endDate = null;
    } else {
      const prereqEnds = (t.depends_on ?? [])
        .map((d) => endBy.get(d))
        .filter((d): d is Date => d instanceof Date);
      const base = prereqEnds.length > 0 ? new Date(Math.max(...prereqEnds.map((d) => d.getTime()))) : new Date(start);
      startDate = base;
      endDate = addDays(base, t.duration_days ?? 1);
    }
    endBy.set(id, endDate);

    const isDone = done.has(id);
    const status: ScheduledTask["status"] = isDone
      ? "done"
      : blocked
        ? "blocked"
        : waivedIds.includes(id)
          ? "waived"
          : "pending";

    scheduled.push({
      id: t.id,
      title: t.title,
      depends_on: [...(t.depends_on ?? [])],
      skill: t.skill,
      target_proficiency: t.target_proficiency,
      non_waivable: t.non_waivable || NON_WAIVABLE_TASK_IDS.has(t.id),
      duration_days: t.duration_days ?? 1,
      waived: waivedIds.includes(id),
      status,
      start_date: startDate ? startDate.toISOString() : null,
      end_date: endDate ? endDate.toISOString() : null,
      topological_level: level.get(id) ?? 0,
      blocked: blocked ? { note: blocked.note, reported_by: blocked.reported_by, at: blocked.at } : null,
    });
  }

  return scheduled;
}
