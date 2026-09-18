import { describe, expect, it } from "vitest";
import { coverageBreakdown, futureRequirementDiff } from "../skill-graph-metrics";
import type { FitItem, SkillAssertion } from "../skill-graph";

const item = (skill: string, classification: FitItem["classification"] = "direct"): FitItem => ({
  skill,
  classification,
  required_proficiency: 3,
  candidate_proficiency: 2,
  edge: null,
  contribution: 0.5,
  reason: "",
});

const assertion = (skill: string, review_state: string, proficiency = 3): SkillAssertion => ({
  id: `a-${skill}`,
  skill_name: skill,
  claimed_proficiency: proficiency,
  proficiency_tier: null,
  review_state,
  evidence_ids: [],
  created_at: "2026-09-01T09:00:00Z",
});

describe("futureRequirementDiff (E1)", () => {
  it("reports added, raised and removed skills", () => {
    const d = futureRequirementDiff(
      [{ skill: "Go", target_proficiency: 4 }, { skill: "Docker", target_proficiency: 3 }],
      [{ skill: "Go", target_proficiency: 5 }, { skill: "Kubernetes", target_proficiency: 2 }]
    );
    expect(d.added).toEqual([{ skill: "Kubernetes", target_proficiency: 2 }]);
    expect(d.raised).toEqual([{ skill: "Go", target_proficiency: 5 }]);
    expect(d.removed).toEqual([{ skill: "Docker", target_proficiency: 3 }]);
  });

  it("is case-insensitive on skill names", () => {
    const d = futureRequirementDiff([{ skill: "sql", target_proficiency: 3 }], [{ skill: "SQL", target_proficiency: 3 }]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.raised).toEqual([]);
  });
});

describe("coverageBreakdown (E2)", () => {
  it("counts verified / unverified / missing across direct skills", () => {
    const direct = [item("Go"), item("PostgreSQL"), item("Docker"), item("REST APIs")];
    const assertions = [
      assertion("Go", "reviewer_confirmed"),
      assertion("PostgreSQL", "assessment_supported"),
      assertion("Docker", "claimed"),
    ];
    const c = coverageBreakdown(direct, assertions);
    expect(c).toEqual({ directTotal: 4, verified: 2, unverified: 1, missing: 1 });
  });

  it("counts a skill as verified when any assertion is accepted", () => {
    const direct = [item("Go")];
    const assertions = [assertion("Go", "claimed", 5), assertion("Go", "reviewer_confirmed", 4)];
    const c = coverageBreakdown(direct, assertions);
    expect(c.verified).toBe(1);
    expect(c.unverified).toBe(0);
  });

  it("only counts direct skills the caller passes — assertions on adjacent/transferable skills do not inflate direct coverage", () => {
    const direct = [item("Go", "direct")];
    const assertions = [assertion("Kubernetes", "reviewer_confirmed"), assertion("Docker", "reviewer_confirmed")];
    expect(coverageBreakdown(direct, assertions)).toEqual({ directTotal: 1, verified: 0, unverified: 0, missing: 1 });
  });

  it("returns zeros when there are no direct skills", () => {
    expect(coverageBreakdown([], [])).toEqual({ directTotal: 0, verified: 0, unverified: 0, missing: 0 });
  });
});
