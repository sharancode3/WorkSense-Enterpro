import { describe, expect, it } from "vitest";
import { coverageBreakdown, futureRequirementDiff, projectedFutureReadiness } from "../skill-graph-metrics";
import type { FitItem, FitRecord, SkillAssertion } from "../skill-graph";

const item = (skill: string, classification: FitItem["classification"] = "direct"): FitItem => ({
  skill,
  classification,
  required_proficiency: 3,
  candidate_proficiency: 2,
  edge: null,
  contribution: 0.5,
  reason: "",
});

const fit = (classification: {
  direct?: FitItem[];
  adjacent?: FitItem[];
  transferable?: FitItem[];
  gaps?: FitItem[];
}, sections?: Partial<FitRecord["sections"]>): FitRecord =>
  ({
    target_type: "requisition",
    target_id: "r1",
    target_title: "Role",
    scenario: "future",
    score: 0.4,
    sections: {
      direct: { value: 0.5, items: classification.direct ?? [] },
      adjacent: { value: 0, items: classification.adjacent ?? [] },
      evidence: { value: 1, artifact_count: 5, threshold: 5 },
      seniority: { value: 1, candidate_level: 3, role_level: 3 },
      ...sections,
    },
    classification: {
      direct: classification.direct ?? [],
      adjacent: classification.adjacent ?? [],
      transferable: classification.transferable ?? [],
      gaps: classification.gaps ?? [],
    },
    computed_at: "2026-09-01T09:00:00Z",
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

describe("projectedFutureReadiness (§53/§55)", () => {
  it("projected score is always >= the raw future score", () => {
    // 4 future requirements: 1 met direct, 1 partial direct, 1 adjacent, 1 pure gap.
    const f = fit({
      direct: [{ ...item("Go", "direct"), candidate_proficiency: 4, required_proficiency: 3 }, item("SQL", "direct")],
      adjacent: [item("Kubernetes", "adjacent")],
      gaps: [item("ML Ops", "gap")],
    });
    const r = projectedFutureReadiness(f);
    expect(r.score).toBeGreaterThan(f.score);
    expect(r.total).toBe(4);
    expect(r.metSkills).toBe(1);
    // partial direct + adjacent + pure gap all still need development
    expect(r.developmentPlan.length).toBe(3);
    expect(r.alreadyMet.map((i) => i.skill)).toEqual(["Go"]);
  });

  it("credits learning even with zero foundation (pure gaps still project forward)", () => {
    // No overlap at all: the classic "current == future" case.
    const f = fit({ gaps: [item("Policy Management", "gap"), item("People Analytics", "gap")] });
    const r = projectedFutureReadiness(f);
    expect(r.total).toBe(2);
    expect(r.metSkills).toBe(0);
    expect(r.developmentPlan.length).toBe(2);
    // 2 × 0.35 / 2 = 0.35 direct → 0.5*0.35 + 0.25*0 + 0.15*1 + 0.1*1 = 0.425
    expect(r.score).toBeCloseTo(0.425, 5);
    expect(r.score).toBeGreaterThan(f.score);
  });

  it("ranks stronger foundations first in the development plan", () => {
    const f = fit({
      adjacent: [item("Kubernetes", "adjacent")],
      transferable: [item("Redis", "transferable")],
      gaps: [item("ML Ops", "gap")],
    });
    const r = projectedFutureReadiness(f);
    expect(r.developmentPlan.map((d) => d.skill)).toEqual(["Kubernetes", "Redis", "ML Ops"]);
    expect(r.developmentPlan.map((d) => d.attainment)).toEqual([0.85, 0.6, 0.35]);
  });

  it("matches the raw score when there is nothing to develop (all met)", () => {
    const met = { ...item("Go", "direct"), candidate_proficiency: 4, required_proficiency: 3 };
    const f = fit({ direct: [met] });
    const r = projectedFutureReadiness(f);
    expect(r.developmentPlan.length).toBe(0);
    expect(r.metSkills).toBe(1);
    // direct = 1, adjacent raw 0, evidence 1, seniority 1
    expect(r.score).toBeCloseTo(0.5 * 1 + 0.25 * 0 + 0.15 * 1 + 0.1 * 1, 5);
  });

  it("handles an empty requirement set without dividing by zero", () => {
    const r = projectedFutureReadiness(fit({}));
    expect(r.score).toBe(0.4);
    expect(r.total).toBe(0);
  });
});
