import { describe, expect, it } from "vitest";
import { buildOnboardingQueue, type JourneyInput } from "./onboarding-queue";

const now = "2026-09-18T09:00:00Z";

function journey(partial: Partial<JourneyInput> = {}): JourneyInput {
  return {
    plan: {
      id: "p1",
      twin_id: "t1",
      version: 2,
      status: "approved",
      start_date: "2026-09-01T09:00:00Z",
      readiness: {
        ready_pct: 40,
        provisional: true,
        blocked_count: 1,
        satisfied: 3,
        total: 8,
        dimensions: [
          { key: "access", label: "System access", pct: 50 },
          { key: "compliance", label: "Compliance", pct: 100 },
          { key: "capability", label: "Role capability", pct: 0 },
        ],
      },
      manager_approval: { at: "2026-09-02T09:00:00Z" },
      hr_approval: { at: "2026-09-02T09:00:00Z" },
    },
    employee: {
      id: "t1",
      name: "Alex Chen",
      job_title: "Engineer",
      department: "Platform",
      manager_id: "m1",
    },
    tasks: [
      { task_code: "security_training", title: "Security & Compliance Training", task_type: "policy", owner_role: "employee", state: "done", due_date: "2026-09-02T09:00:00Z", topological_level: 0, depends_on: [], blockers: [] },
      { task_code: "access_sso", title: "System Access & SSO", task_type: "access", owner_role: "it_security", state: "blocked", due_date: null, topological_level: 1, depends_on: ["it_provisioning", "security_training"], blockers: [{ status: "open", at: "2026-09-10T09:00:00Z" }] },
      { task_code: "team_intro", title: "Team Introduction", task_type: "onboarding_admin", owner_role: "manager", state: "pending", due_date: null, topological_level: 2, depends_on: ["access_sso"], blockers: [] },
    ],
    ...partial,
  };
}

describe("buildOnboardingQueue — Batch D overview fields", () => {
  it("passes department through from the employee", () => {
    const res = buildOnboardingQueue({ role: "hr", journeys: [journey()], now });
    expect(res.journeys[0].department).toBe("Platform");
  });

  it("reports owned-task completion separately from readiness", () => {
    const res = buildOnboardingQueue({ role: "hr", journeys: [journey()], now });
    expect(res.journeys[0].completed_tasks).toBe(3);
    expect(res.journeys[0].total_tasks).toBe(8);
    expect(res.journeys[0].readiness_pct).toBe(40);
  });

  it("exposes the mandatory readiness gates (dimensions)", () => {
    const res = buildOnboardingQueue({ role: "hr", journeys: [journey()], now });
    expect(res.journeys[0].gates).toHaveLength(3);
    expect(res.journeys[0].gates[0]).toEqual({ key: "access", label: "System access", pct: 50 });
  });

  it("falls back to deriving counts when readiness totals are absent (legacy rows)", () => {
    const j = journey();
    j.plan.readiness = { ready_pct: 33, provisional: true, blocked_count: 1 };
    const res = buildOnboardingQueue({ role: "hr", journeys: [j], now });
    // done(1) + waived(0) from tasks; totals from the task list.
    expect(res.journeys[0].completed_tasks).toBe(1);
    expect(res.journeys[0].total_tasks).toBe(3);
    expect(res.journeys[0].gates).toEqual([]);
  });

  it("keeps stalled/overdue/approval signals intact", () => {
    const res = buildOnboardingQueue({ role: "hr", journeys: [journey()], now });
    const jj = res.journeys[0];
    expect(jj.stalled).toBe(true);
    expect(jj.stall_reasons).toContain("1 open blocker(s)");
    expect(jj.pending_manager_approval).toBe(false);
  });

  it("marks a pending_approval journey as awaiting sign-off", () => {
    const j = journey();
    j.plan.status = "pending_approval";
    j.plan.manager_approval = null;
    j.plan.hr_approval = null;
    j.plan.readiness = { ready_pct: 0, provisional: true, blocked_count: 0, satisfied: 0, total: 8, dimensions: [] };
    const res = buildOnboardingQueue({ role: "hr", journeys: [j], now });
    expect(res.journeys[0].pending_manager_approval).toBe(true);
    expect(res.journeys[0].pending_hr_approval).toBe(true);
  });
});
