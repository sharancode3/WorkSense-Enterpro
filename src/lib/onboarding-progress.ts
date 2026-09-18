// Phase 1: ONE derivation for onboarding facts, shared by every screen.
//
// The adaptive plan (onboarding_plans + onboarding_tasks) is the canonical
// onboarding representation. Task states are authoritative — the backend
// recomputes and rewrites every row on each action — and plan.readiness is the
// stored snapshot the backend refreshes on the same actions. The employee home,
// the onboarding center and the org dashboard all derive their numbers from
// these rules so the same record can never produce conflicting counts.
//
// Deliberately dependency-free (only types) so it can be unit-tested against
// real plan/task rows and reused without pulling in query machinery.

import type { PlanTaskView } from "@/lib/api";

/** Task-state chip meta shared by the employee home and the onboarding center. */
export const TASK_STATE_META: Record<PlanTaskView["state"], { label: string; cls: string }> = {
  done: { label: "Done", cls: "bg-secondary text-white" },
  waived: { label: "Waived", cls: "bg-primary/15 text-primary" },
  blocked: { label: "Blocked", cls: "bg-destructive text-white" },
  pending: { label: "Queued", cls: "bg-muted text-foreground" },
  ready: { label: "Ready", cls: "bg-accent text-foreground" },
  in_progress: { label: "In progress", cls: "bg-accent text-foreground" },
  failed: { label: "Failed", cls: "bg-destructive/15 text-destructive" },
};

export interface PlanCounts {
  /** state === "done" */
  completed: number;
  /** state === "waived" */
  waived: number;
  /** done + waived — identical to the engine's readiness.satisfied */
  satisfied: number;
  /** state === "blocked" */
  blocked: number;
  /** state === "failed" */
  failed: number;
  in_progress: number;
  ready: number;
  /** state === "pending" (queued behind unmet prerequisites) */
  queued: number;
  total: number;
}

/**
 * Derive the canonical task counts from task states. These are the numbers
 * every surface must show; anything else is a derivable inconsistency.
 */
export function derivePlanCounts(tasks: Pick<PlanTaskView, "state">[]): PlanCounts {
  const counts: PlanCounts = {
    completed: 0,
    waived: 0,
    satisfied: 0,
    blocked: 0,
    failed: 0,
    in_progress: 0,
    ready: 0,
    queued: 0,
    total: tasks.length,
  };
  for (const t of tasks) {
    switch (t.state) {
      case "done":
        counts.completed += 1;
        counts.satisfied += 1;
        break;
      case "waived":
        counts.waived += 1;
        counts.satisfied += 1;
        break;
      case "blocked":
        counts.blocked += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "in_progress":
        counts.in_progress += 1;
        break;
      case "ready":
        counts.ready += 1;
        break;
      case "pending":
        counts.queued += 1;
        break;
    }
  }
  return counts;
}

/**
 * Whether a plan is blocked at all — true when any task is blocked or failed.
 * This is exactly the engine's readiness.blocked_count > 0, used by the
 * dashboard's journeys_blocked card.
 */
export function planIsBlocked(tasks: Pick<PlanTaskView, "state">[]): boolean {
  return tasks.some((t) => t.state === "blocked" || t.state === "failed");
}

/** First actionable task for "next action": prefer unblocked, then any incomplete. */
export function nextActionTask(tasks: PlanTaskView[]): PlanTaskView | null {
  return (
    tasks.find((t) => t.state !== "done" && t.state !== "waived" && (t.state === "ready" || t.state === "in_progress")) ??
    tasks.find((t) => t.state !== "done" && t.state !== "waived") ??
    null
  );
}
