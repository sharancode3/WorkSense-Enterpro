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

describe("projectedFutureReadiness (§53)", () => {
  it("projected score is always >= the raw future score when foundations exist", () => {
    // 4 future requirements: 1 met direct, 1 partial direct, 1 adjacent, 1 pure gap.
    const f = fit({
      direct: [{ ...item("Go", "direct"), candidate_proficiency: 4, required_proficiency: 3 }, item("SQL", "direct")],
      adjacent: [item("Kubernetes", "adjacent")],
      gaps: [item("ML Ops", "gap")],
    });
    const r = projectedFutureReadiness(f);
    // met(1) + closable(partial direct + adjacent = 2) / 4 -> 0.75 direct
    expect(r.score).toBeGreaterThan(f.score);
    expect(r.closable.length).toBe(2);
    expect(r.remaining.length).toBe(1);
    expect(r.directMet).toBe(1);
    expect(r.total).toBe(4);
  });

  it("matches the raw score when there is nothing closable (all met or pure gaps)", () => {
    const met = { ...item("Go", "direct"), candidate_proficiency: 4, required_proficiency: 3 };
    const gap = item("ML Ops", "gap");
    const f = fit({ direct: [met], gaps: [gap] });
    const r = projectedFutureReadiness(f);
    expect(r.closable.length).toBe(0);
    // direct = 1/2, adjacent stays 0, evidence 1, seniority 1
    expect(r.score).toBeCloseTo(0.5 * 0.5 + 0.25 * 0 + 0.15 * 1 + 0.1 * 1, 5);
  });

  it("reaches the projected ceiling when every requirement is closable", () => {
    const f = fit({ adjacent: [item("K8s", "adjacent"), item("Docker", "adjacent")] });
    const r = projectedFutureReadiness(f);
    expect(r.remaining.length).toBe(0);
    // direct = 2/2 = 1; adjacent = 1 (no pure gaps left); evidence 1; seniority 1
    expect(r.score).toBeCloseTo(0.5 * 1 + 0.25 * 1 + 0.15 * 1 + 0.1 * 1, 5);
    expect(r.score).toBe(1);
  });

  it("handles an empty requirement set without dividing by zero", () => {
    const r = projectedFutureReadiness(fit({}));
    expect(r.score).toBe(0.4);
    expect(r.total).toBe(0);
  });
});
