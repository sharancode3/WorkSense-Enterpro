import { describe, expect, it } from "vitest";
import { decode, planTaskViewSchema, planViewSchema } from "../contracts";
import { derivePlanCounts, nextActionTask, planIsBlocked, TASK_STATE_META } from "../onboarding-progress";
import type { PlanTaskState } from "../api";

// Phase 1: the onboarding TRUTH contract. Every fact below is captured from
// the real seeded rows for Alex Chen (plan v1, approved) so the test locks the
// invariant that the employee home and the onboarding center derive identical
// numbers from the same record. If the derivation ever drifts, this fails.
const ALEX_PLAN_ROW = {
  id: "da642f26-81d0-4412-b9f2-6dbef92c386d",
  twin_id: "22222222-2222-2222-2222-222222222203",
  application_id: "application-alex",
  version: 1,
  plan_hash: "seeded-hash",
  status: "approved",
  manager_approval: { by: "jordan@worksense.demo", by_twin_id: "22222222-2222-2222-2222-222222222202", at: "2026-09-15T09:00:00Z" },
  hr_approval: { by: "dana@worksense.demo", by_twin_id: "22222222-2222-2222-2222-222222222201", at: "2026-09-15T09:00:00Z" },
  start_date: "2026-07-21T09:00:00Z",
  generated_at: "2026-09-15T09:00:00Z",
  readiness: {
    ready_pct: 8.3,
    satisfied: 1,
    total: 12,
    remaining_critical_days: 4.5,
    projected_ready_date: "2026-09-19T21:00:00Z",
    blocked_count: 9,
    note: "Estimated readiness — projected earliest completion if every blocker clears today; blocked work makes this provisional, not a guarantee.",
  },
  carryover: [],
  audit_events: [],
};

const ALEX_TASK_STATES: { task_code: string; title: string; state: PlanTaskState }[] = [
  { task_code: "it_provisioning", title: "IT & Laptop Provisioning", state: "ready" },
  { task_code: "payroll", title: "Direct Deposit & Payroll Setup", state: "ready" },
  { task_code: "security_training", title: "Security & Compliance Training", state: "done" },
  { task_code: "access_sso", title: "System Access & SSO Enrollment", state: "blocked" },
  { task_code: "team_intro", title: "Team Introduction & Codebase Walkthrough", state: "blocked" },
  { task_code: "learn_docker", title: "First contribution using Docker", state: "blocked" },
  { task_code: "learn_go", title: "First contribution using Go", state: "blocked" },
  { task_code: "learn_postgresql", title: "First contribution using PostgreSQL", state: "blocked" },
  { task_code: "future_event_driven_architecture", title: "Upskilling plan: Event-driven architecture", state: "blocked" },
  { task_code: "future_kubernetes", title: "Upskilling plan: Kubernetes", state: "blocked" },
  { task_code: "survey", title: "Onboarding Feedback Survey", state: "blocked" },
  { task_code: "verify_go", title: "Verification: Go mastery assessment", state: "blocked" },
];

describe("onboarding source-of-truth contract (adaptive plan is canonical)", () => {
  const plan = decode(planViewSchema, ALEX_PLAN_ROW, "plan-row");
  const tasks = ALEX_TASK_STATES.map((t) => decode(planTaskViewSchema, { ...t, task_type: "learning", owner_role: "employee", required: true, non_waivable: false, depends_on: [], duration_days: 1, due_date: null, topological_level: 0, why_evidence: { reason: "r", source_evidence: [] }, evidence_requirements: [], blocked_reasons: [], blockers: [], waiver: null, completion_record: null, adaptation: null }, "plan-task-row"));

  it("derived counts equal the stored readiness the onboarding center displays", () => {
    const counts = derivePlanCounts(tasks);
    expect(counts.satisfied).toBe(plan.readiness.satisfied); // 1
    expect(counts.total).toBe(plan.readiness.total); // 12
    expect(counts.completed).toBe(1);
    expect(counts.waived).toBe(0);
  });

  it("blocked+failed from task states equals readiness.blocked_count", () => {
    const counts = derivePlanCounts(tasks);
    expect(counts.blocked + counts.failed).toBe(plan.readiness.blocked_count); // 9
  });

  it("planIsBlocked agrees with the dashboard blocked card (readiness.blocked_count > 0)", () => {
    expect(planIsBlocked(tasks)).toBe(plan.readiness.blocked_count > 0);
  });

  it("the employee home stat and onboarding center show the same completed/total string", () => {
    const counts = derivePlanCounts(tasks);
    const homeStat = `${plan.readiness.satisfied}/${plan.readiness.total}`;
    const onboardingReadiness = `${counts.satisfied}/${counts.total}`;
    expect(homeStat).toBe(onboardingReadiness);
    expect(homeStat).toBe("1/12");
  });

  it("laptop is ready and team introduction is blocked on the same record (legacy said done for both)", () => {
    const laptop = tasks.find((t) => t.task_code === "it_provisioning");
    const teamIntro = tasks.find((t) => t.task_code === "team_intro");
    expect(laptop?.state).toBe("ready");
    expect(teamIntro?.state).toBe("blocked");
  });

  it("nextActionTask prefers an unblocked incomplete task (Alex: IT provisioning)", () => {
    const next = nextActionTask(tasks);
    expect(next?.task_code).toBe("it_provisioning");
  });

  it("TASK_STATE_META labels every state a screen can render", () => {
    for (const state of ["pending", "blocked", "ready", "in_progress", "done", "waived", "failed"] as PlanTaskState[]) {
      expect(TASK_STATE_META[state].label.length).toBeGreaterThan(0);
    }
  });
});
