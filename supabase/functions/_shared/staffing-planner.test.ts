import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSUMPTIONS,
  planStaffing,
  type Candidate,
  type Person,
  type ScenarioInput,
} from "./staffing-planner.ts";

const baseScenario = (over: Partial<ScenarioInput> = {}): ScenarioInput => ({
  name: "Test scenario",
  demand_title: "Senior Backend Engineer",
  required_skills: [
    { skill: "Go", min_proficiency: 3, mandatory: true },
    { skill: "REST APIs", min_proficiency: 3, mandatory: true },
  ],
  capacity_people: 1,
  deadline_days: 42,
  budget_usd: 60000,
  horizon_months: 12,
  assumptions_version: "v1",
  ...over,
});

const person = (id: string, skills: Person["skills"], over: Partial<Person> = {}): Person => ({
  id, name: `Person ${id}`, skills, current_assignment: null, ...over,
});

const candidate = (id: string, skills: Candidate["skills"], status = "active", match_score = 0.5): Candidate => ({
  id, name: `Candidate ${id}`, status, skills, match_score,
});

describe("staffing-planner (Phase 10 acceptance regressions)", () => {
  it("a 56-day hire track is NOT presented as ready at a 42-day deadline (never clamped)", () => {
    const plan = planStaffing(
      baseScenario({ deadline_days: 42 }),
      [],
      [candidate("c1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }, { name: "REST APIs", proficiency: 4, verification_rigor: "medium" }], "active", 0.8)]
    );
    const hire = plan.options.find((o) => o.id === "hire")!;
    expect(hire.ready_at_days).toBe(DEFAULT_ASSUMPTIONS.hire_lead_days); // 56
    expect(hire.meets_deadline).toBe(false);
    expect(hire.status).toBe("infeasible");
    expect(hire.status_reason.toLowerCase()).toContain("not clamped");
  });

  it("a 54% match does not automatically mean role-ready when a mandatory skill is missing", () => {
    const plan = planStaffing(
      baseScenario(),
      [],
      [candidate("c1", [{ name: "Go", proficiency: 4, verification_rigor: "low" }], "active", 0.54)]
    );
    const hire = plan.options.find((o) => o.id === "hire")!;
    // REST APIs is mandatory and missing -> not mandatory_satisfied, not ready.
    expect(hire.mandatory_satisfied).toBe(false);
    expect(hire.mandatory_missing).toContain("REST APIs");
    expect(hire.status).toBe("infeasible");
    expect(hire.status_reason).toMatch(/role-ready/i);
  });

  it("hybrid uses the ACTUAL LATEST finish (max of both tracks), not the deadline", () => {
    const plan = planStaffing(
      baseScenario({ deadline_days: 42 }),
      [person("p1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }])],
      [candidate("c1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }, { name: "REST APIs", proficiency: 4, verification_rigor: "medium" }], "active", 0.8)]
    );
    const hybrid = plan.options.find((o) => o.id === "hybrid")!;
    // Hire ready 56, upskill ready = 21 (train REST APIs) + 7 verify = 28 -> latest = 56.
    expect(hybrid.ready_at_days).toBe(Math.max(56, 28));
    expect(hybrid.ready_at_days).toBe(56);
    expect(hybrid.meets_deadline).toBe(false);
    expect(hybrid.status).toBe("infeasible");
    expect(hybrid.status_reason).toContain("never clamped");
  });

  it("hybrid describes phased availability instead of calling the entire team ready", () => {
    const plan = planStaffing(
      baseScenario({ deadline_days: 90 }),
      [person("p1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }])],
      [candidate("c1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }, { name: "REST APIs", proficiency: 4, verification_rigor: "medium" }], "active", 0.8)]
    );
    const hybrid = plan.options.find((o) => o.id === "hybrid")!;
    expect(hybrid.meets_deadline).toBe(true);
    expect(hybrid.status_reason).toMatch(/phased availability/i);
    expect(hybrid.ready_at_days).toBe(56);
  });

  it("training creates a CONDITIONAL projection until verification succeeds", () => {
    const plan = planStaffing(
      baseScenario(),
      [person("p1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }])],
      []
    );
    const upskill = plan.options.find((o) => o.id === "upskill")!;
    const rest = upskill.skill_coverage.find((r) => r.skill === "REST APIs")!;
    expect(rest.coverage).toBe("conditional");
    expect(upskill.status).toBe("conditional");
    expect(upskill.status_reason).toMatch(/CONDITIONAL until verification/i);
    // Separates current verified coverage from conditional coverage.
    expect(upskill.verified_coverage_pct).toBe(50); // Go verified, REST conditional
    expect(upskill.conditional_coverage_pct).toBe(100);
  });

  it("internal move requires availability and models approval + handover", () => {
    const busy = planStaffing(
      baseScenario(),
      [person("p1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }, { name: "REST APIs", proficiency: 4, verification_rigor: "medium" }], { current_assignment: "Core payments project" })],
      []
    );
    const move = busy.options.find((o) => o.id === "move")!;
    expect(move.status).toBe("infeasible");
    expect(move.status_reason).toContain("currently assigned");

    const free = planStaffing(
      baseScenario(),
      [person("p1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }, { name: "REST APIs", proficiency: 4, verification_rigor: "medium" }])],
      []
    );
    const moveFree = free.options.find((o) => o.id === "move")!;
    expect(moveFree.status).toBe("feasible");
    expect(moveFree.ready_at_days).toBe(DEFAULT_ASSUMPTIONS.manager_approval_days + DEFAULT_ASSUMPTIONS.move_transition_days);
    expect(moveFree.timeline.some((s) => s.kind === "approval")).toBe(true);
    expect(moveFree.timeline.some((s) => s.kind === "handover")).toBe(true);
  });

  it("excludes rejected/expired/stale candidates by explicit rules", () => {
    const staleIso = new Date(Date.now() - 400 * 86400000).toISOString();
    const freshIso = new Date(Date.now() - 10 * 86400000).toISOString();
    const fullSkills = [
      { name: "Go", proficiency: 4, verification_rigor: "medium" as const },
      { name: "REST APIs", proficiency: 4, verification_rigor: "medium" as const },
    ];
    const plan = planStaffing(
      baseScenario(),
      [],
      [
        { ...candidate("fresh", fullSkills, "active"), applied_at: freshIso },
        { ...candidate("rejected", fullSkills, "rejected"), applied_at: freshIso },
        { ...candidate("stale", fullSkills, "active"), applied_at: staleIso },
      ]
    );
    const hire = plan.options.find((o) => o.id === "hire")!;
    // rejected + stale are excluded by rule; only "fresh" remains.
    expect(hire.subject).toBe("Candidate fresh");
  });

  it("status vocabulary covers feasible / conditional / infeasible / insufficient_data", () => {
    const empty = planStaffing(baseScenario(), [], []);
    const statuses = new Set(empty.options.map((o) => o.status));
    // No candidates -> hire/upskill are insufficient_data or infeasible.
    expect(statuses.has("insufficient_data") || statuses.has("infeasible")).toBe(true);
    for (const o of empty.options) {
      expect(["feasible", "conditional", "infeasible", "insufficient_data"]).toContain(o.status);
    }
  });

  it("never hardcodes a recommended option and explains why options satisfy or fail", () => {
    const plan = planStaffing(
      baseScenario(),
      [person("p1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }])],
      [candidate("c1", [{ name: "Go", proficiency: 4, verification_rigor: "medium" }, { name: "REST APIs", proficiency: 4, verification_rigor: "medium" }], "active", 0.8)]
    );
    expect(plan.decision_table).toHaveLength(plan.options.length);
    expect("recommended" in plan).toBe(false); // no hardcoded recommendation
    for (const o of plan.options) {
      expect(o.rationale.length).toBeGreaterThan(20);
    }
  });
});
