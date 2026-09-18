import type { QueueTaskRef } from "./contracts";

/**
 * Batch 3 (3.6) — pure helpers for the IT Provisioning home workspace.
 * The provisioning queue arrives as server-scoped QueueTaskRef rows plus a
 * minimal people projection; these helpers turn them into operational counts
 * and upcoming-start lists without any further backend access.
 */

export interface ItQueueCounts {
  ready: number;
  in_progress: number;
  blocked: number;
  done: number;
  overdue: number;
  total: number;
}

const ACTIONABLE = new Set(["ready", "in_progress", "pending"]);

/** Count provisioning tasks by operational state; overdue = actionable past due. */
export function deriveItQueueCounts(tasks: QueueTaskRef[], now: string): ItQueueCounts {
  const counts: ItQueueCounts = { ready: 0, in_progress: 0, blocked: 0, done: 0, overdue: 0, total: tasks.length };
  for (const t of tasks) {
    if (t.state === "ready") counts.ready += 1;
    else if (t.state === "in_progress") counts.in_progress += 1;
    else if (t.state === "blocked") counts.blocked += 1;
    else if (t.state === "done") counts.done += 1;
    if (ACTIONABLE.has(t.state) && t.due_date && new Date(t.due_date).getTime() < new Date(now).getTime()) {
      counts.overdue += 1;
    }
  }
  return counts;
}

export interface UpcomingStart {
  twin_id: string;
  name: string;
  start_date: string;
  manager_name: string | null;
}

/**
 * Upcoming start dates within the next `days` (inclusive), oldest first.
 * Used to surface "who starts soon" so provisioning can be prepared.
 */
export function upcomingStarts(people: { twin_id: string; name: string; start_date: string | null; manager_name: string | null }[], now: string, days = 14): UpcomingStart[] {
  const windowEnd = new Date(new Date(now).getTime() + days * 86400000).getTime();
  return people
    .filter((p): p is { twin_id: string; name: string; start_date: string; manager_name: string | null } => {
      if (!p.start_date) return false;
      const t = new Date(p.start_date).getTime();
      return t >= new Date(now).getTime() && t <= windowEnd;
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((p) => ({ twin_id: p.twin_id, name: p.name, start_date: p.start_date, manager_name: p.manager_name }));
}
