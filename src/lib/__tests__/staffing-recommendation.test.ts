import { describe, expect, it } from "vitest";
import { recommendOption } from "@/lib/staffing-recommendation";
import type { PlannerOption } from "@/lib/api";

const opt = (overrides: Partial<PlannerOption>): PlannerOption => ({
  id: "move",
  label: "Internal move",
  status: "feasible",
  status_reason: "",
  skill_coverage: [],
  verified_coverage_pct: 100,
  conditional_coverage_pct: 100,
  mandatory_satisfied: true,
  mandatory_missing: [],
  timeline: [],
  ready_at_days: 19,
  meets_deadline: true,
  cost_usd: 6000,
  budget_satisfied: true,
  dependency_risk: "low",
  constraints_satisfied: [],
  constraints_violated: [],
  rationale: "",
  subject: "Diego Mensah",
  ...overrides,
});

describe("staffing recommendation rule (Batch F)", () => {
  it("recommends the eligible option with the highest verified coverage", () => {
    const hire = opt({ id: "hire", label: "Hire externally", verified_coverage_pct: 50, cost_usd: 45000 });
    const move = opt({ id: "move", label: "Internal move", verified_coverage_pct: 100 });
    expect(recommendOption([hire, move])).toBe("move");
  });

  it("breaks ties by lower cost, then earlier ready date", () => {
    const a = opt({ id: "upskill", verified_coverage_pct: 80, cost_usd: 4800, ready_at_days: 28 });
    const b = opt({ id: "hire", verified_coverage_pct: 80, cost_usd: 45000, ready_at_days: 28 });
    const c = opt({ id: "move", verified_coverage_pct: 80, cost_usd: 4800, ready_at_days: 19 });
    expect(recommendOption([a, b, c])).toBe("move");
  });

  it("excludes options that miss the deadline or budget, or fail the mandatory gate", () => {
    const infeasible = opt({ id: "hire", meets_deadline: false });
    const overBudget = opt({ id: "upskill", budget_satisfied: false });
    const missingMandatory = opt({ id: "move", mandatory_satisfied: false });
    expect(recommendOption([infeasible, overBudget, missingMandatory])).toBeNull();
  });

  it("returns null for an empty or all-ineligible set (no recommendation is honest)", () => {
    expect(recommendOption([])).toBeNull();
    expect(recommendOption([opt({ id: "hire", meets_deadline: false, budget_satisfied: false })])).toBeNull();
  });
});
