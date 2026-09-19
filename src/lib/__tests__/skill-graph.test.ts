import { describe, expect, it } from "vitest";
import { coverageBreakdown, developmentForecast, futureRequirementDiff, resolvedFutureRequirements } from "../skill-graph-metrics";
import type { DevelopmentPlan } from "../skill-graph-metrics";
import type { FitItem, FitRecord } from "../skill-graph";

const item = (skill: string, relationship: FitItem["relationship"] = "direct"): FitItem => ({
  skill,
  classification: relationship === "direct" ? "verified_direct" : relationship === "adjacent" ? "adjacent_support" : relationship === "transferable" ? "transferable_foundation" : "missing",
  relationship,
  mandatory: true,
  required_proficiency: 3,
  candidate_proficiency: relationship === "direct" ? 3 : null,
  effective_proficiency: relationship === "direct" ? 3 : 0,
  gap: relationship === "direct" ? 0 : 3,
  evidence_state: "reviewer_confirmed",
  evidence_source: "artifact:resume|r1",
  freshness_days: 5,
  evidence_factor: 1,
  verified_contribution: relationship === "direct" ? 1 : 0,
  contribution: relationship === "direct" ? 1 : 0,
  verified: relationship === "direct",
  provisional: relationship === "direct",
  next_action: "none",
  edge: null,
  reason: "",
});

const req = (skill: string, target_proficiency: number, mandatory = true) => ({ skill, target_proficiency, mandatory });

const fit = (requirements: FitItem[]): FitRecord => ({
  target_type: "requisition",
  target_id: "r1",
  target_title: "Role",
  scenario: "current",
  score: 0.4,
  profile_match: 0.5,
  evidence_confidence: 0.6,
  mandatory_gate: { met: true, unmet_skills: [], count: 0, note: "" },
  contextual_alignment: { candidate_level: 3, role_level: 3, note: "" },
  scoring: {
    requirements,
    mandatory: { count: 0, met: 0, unmet: 0, unmet_skills: [], gated: false, readiness: 0.4 },
    preferred: null,
    verified: { readiness: 0.4 },
    provisional: { readiness: 0.5 },
    confidence: 0.6,
    group_weights: { mandatory: 0.7, preferred: 0.3 },
    evidence_artifacts: { count: 1, threshold: 5 },
    resolved_from: "current",
  },
  classification: {
    verified_direct: requirements.filter((i) => i.classification === "verified_direct"),
    provisional_direct: requirements.filter((i) => i.classification === "provisional_direct"),
    below_target: requirements.filter((i) => i.classification === "below_target"),
    adjacent_support: requirements.filter((i) => i.classification === "adjacent_support"),
    transferable_foundation: requirements.filter((i) => i.classification === "transferable_foundation"),
    missing: requirements.filter((i) => i.classification === "missing"),
  },
  computed_at: "2026-09-01T09:00:00Z",
});

const assertion = (skill: string, review_state: string, proficiency = 3) => ({
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

describe("resolvedFutureRequirements (Phase 9)", () => {
  it("resolves additions, raised targets and explicit obsolete removals", () => {
    const r = resolvedFutureRequirements(
      [req("Go", 4), req("Docker", 3), req("PostgreSQL", 3)],
      [req("Go", 5), req("Kubernetes", 2)],
      [req("PostgreSQL", 3)]
    );
    expect(r.added).toEqual(["Kubernetes"]);
    expect(r.raised).toEqual(["Go"]);
    expect(r.obsolete).toContain("postgresql");
    const by = new Map(r.resolved.map((s) => [s.skill.toLowerCase(), s]));
    expect(by.get("go")?.target_proficiency).toBe(5);
    expect(by.get("docker")).toBeDefined();
    expect(by.has("postgresql")).toBe(false);
    // additions are future capability signals -> preferred
    expect(by.get("kubernetes")?.mandatory).toBe(false);
  });

  it("keeps current skills missing from the future list (removal only when obsolete)", () => {
    const r = resolvedFutureRequirements([req("Go", 4), req("Docker", 3)], [req("Go", 4)]);
    expect(r.resolved.map((s) => s.skill)).toContain("Docker");
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
});

describe("developmentForecast (Phase 9)", () => {
  const futureFit = fit([item("Go", "direct"), item("TypeScript", "adjacent"), item("Figma", "none")]);

  const plan: DevelopmentPlan = {
    id: "plan-1",
    skills: [
      { skill: "TypeScript", baseline: 2, target: 3, activities: "x", hours: 40 },
      { skill: "Figma", baseline: 0, target: 2, activities: "y", hours: 24 },
    ],
    assessment_gate: "assessment accepted",
    owner: "dana@worksense.demo",
    due_date: "2027-06-30",
    approved: true,
  };

  it("no plan -> Forecast not available with an honest reason (never a fixed-assumption projection)", () => {
    const f = developmentForecast(futureFit, null);
    expect(f.available).toBe(false);
    expect(f.reason).toContain("No development plan");
    expect(f.estimate).toBeNull();
  });

  it("an unapproved plan is not a forecast basis", () => {
    const f = developmentForecast(futureFit, { ...plan, approved: false });
    expect(f.available).toBe(false);
    expect(f.reason).toContain("not approved");
  });

  it("an incomplete plan is not a forecast basis", () => {
    const f = developmentForecast(futureFit, { ...plan, skills: [{ skill: "Figma", baseline: 0, target: 2, activities: "", hours: 0 }] });
    expect(f.available).toBe(false);
    expect(f.reason).toContain("incomplete");
  });

  it("an approved complete plan yields a clearly-labeled scenario estimate with a confidence band", () => {
    const f = developmentForecast(futureFit, plan);
    expect(f.available).toBe(true);
    expect(f.estimate).not.toBeNull();
    expect(f.estimate!.band[0]).toBeLessThanOrEqual(f.estimate!.value);
    expect(f.estimate!.band[1]).toBeGreaterThanOrEqual(f.estimate!.value);
    expect(f.estimate!.note).toContain("estimate");
    expect(f.estimate!.assumptions.length).toBeGreaterThan(0);
  });
});
