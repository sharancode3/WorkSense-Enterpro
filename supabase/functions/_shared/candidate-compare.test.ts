import { describe, expect, it } from "vitest";
import { buildCandidateComparison } from "./candidate-compare.ts";

const req = {
  id: "req-1",
  title: "Senior Backend Engineer",
  audit_events: [{ action: "created", timestamp: "2026-08-05T09:00:00Z" }],
  requisition_criteria: [
    { skill: "Go", target_proficiency: 4, requirement: "required" as const, weight: 0.5, evidence_expectation: "Go project output." },
    { skill: "Docker", target_proficiency: 3, requirement: "preferred" as const, weight: 0.4, evidence_expectation: "Container artifact." },
  ],
  required_skills: [{ skill: "Go", target_proficiency: 4 }],
};

const applicants = [
  { twin_id: "t1", stage: "final_round", version: 2, application_code: "WS-1", applied_at: "2026-08-12T09:00:00Z" },
  { twin_id: "t2", stage: "screening", version: 1, application_code: "WS-2", applied_at: "2026-09-01T09:00:00Z" },
  { twin_id: "t3", stage: "technical_interview", version: 1, application_code: "WS-3", applied_at: "2026-08-20T09:00:00Z" },
  { twin_id: "t4", stage: "screening", version: 1, application_code: "WS-4", applied_at: "2026-08-22T09:00:00Z" },
];

const candidates = new Map([
  ["t1", { id: "t1", name: "Aria Lane", email: "aria@example.com" }],
  ["t2", { id: "t2", name: "Bo Kim", email: "bo@example.com" }],
  ["t3", { id: "t3", name: "Chen Wei", email: "chen@example.com" }],
  ["t4", { id: "t4", name: "Dana Fox", email: "dana@example.com" }],
]);

describe("buildCandidateComparison", () => {
  it("buckets scored (sorted desc), then unscored, then stale", () => {
    const fits = new Map([
      // t1 scored fresh (fit after created audit)
      ["t1", { score: 0.83, computed_at: "2026-08-20T09:00:00Z", scoring: { requirements: [{ skill: "Docker", relationship: "none" }] } }],
      // t2 unscored (no fit)
      // t3 scored lower
      ["t3", { score: 0.41, computed_at: "2026-08-21T09:00:00Z", scoring: { requirements: [{ skill: "Go", relationship: "none" }, { skill: "TypeScript", relationship: "adjacent" }] } }],
      // t4 stale (criteria changed after fit)
      ["t4", { score: 0.66, computed_at: "2026-08-10T09:00:00Z", scoring: { requirements: [] } }],
    ]);
    const res = buildCandidateComparison({
      req: { ...req, audit_events: [...req.audit_events, { action: "requirements_changed", timestamp: "2026-08-15T09:00:00Z" }] },
      applicants,
      candidates,
      fits,
    });
    expect(res.scored_count).toBe(2);
    expect(res.unscored_count).toBe(1);
    expect(res.stale_count).toBe(1);
    // scored sorted desc by score
    expect(res.rows[0].twin_id).toBe("t1");
    expect(res.rows[0].status).toBe("scored");
    expect(res.rows[1].twin_id).toBe("t3");
    // unscored never ranked as zero
    expect(res.rows[2].twin_id).toBe("t2");
    expect(res.rows[2].score).toBeNull();
    // stale listed last, keeps its real score visible (not zeroed)
    expect(res.rows[3].twin_id).toBe("t4");
    expect(res.rows[3].score).toBe(0.66);
  });

  it("never treats a missing score as zero — unscored rows carry null", () => {
    const res = buildCandidateComparison({ req, applicants, candidates, fits: new Map() });
    expect(res.rows.every((r) => r.status === "unscored")).toBe(true);
    expect(res.rows.every((r) => r.score === null)).toBe(true);
    expect(res.scored_count).toBe(0);
  });

  it("marks a fit stale when any requisition audit event is newer than computed_at", () => {
    const fits = new Map([["t1", { score: 0.7, computed_at: "2026-09-01T09:00:00Z", classification: {} }]]);
    const res = buildCandidateComparison({
      req: { ...req, audit_events: [...req.audit_events, { action: "requirements_changed", timestamp: "2026-09-05T09:00:00Z" }] },
      applicants,
      candidates,
      fits,
    });
    expect(res.rows.find((r) => r.twin_id === "t1")?.status).toBe("stale");
  });

  it("exposes criteria for the compare header", () => {
    const res = buildCandidateComparison({ req, applicants, candidates, fits: new Map() });
    expect(res.criteria).toHaveLength(2);
    expect(res.criteria[0].requirement).toBe("required");
  });
});

describe("explainable ranking (audit rework)", () => {
  const fitFor = (over: object) => ({
    score: 0.6,
    computed_at: "2026-09-10T09:00:00Z",
    evidence_confidence: 0.8,
    mandatory_gate: { met: true, unmet_skills: [] },
    scoring: {
      requirements: [
        { skill: "Go", relationship: "direct", verified_contribution: 0.8, contribution: 0.9 },
        { skill: "Docker", relationship: "none", verified_contribution: 0, contribution: 0 },
      ],
      mandatory: { readiness: 0.8 },
      preferred: { readiness: 0.5 },
    },
    ...over,
  });

  it("ranks with a visible weighting policy and renormalizes over known components", () => {
    const res = buildCandidateComparison({
      req,
      applicants,
      candidates,
      fits: new Map([["t1", fitFor({})]]),
      signals: new Map([
        ["t1", { work_sample: 0.9, work_sample_reviewed: true, knowledge: null, knowledge_reviewed: false, interview_score: null, interview_status: "none", assessment_submitted: true }],
      ]),
    });
    const row = res.rows.find((r) => r.twin_id === "t1")!;
    expect(row.rank_tier).toBe("ranked");
    expect(row.rank).not.toBeNull();
    // Known components: mandatory .8, preferred .5, work_sample .9, confidence .8
    // weightSum = .35+.2+.2+.1 = .85 ; rank = (.35*.8+.2*.5+.2*.9+.1*.8)/.85
    const expected = (0.35 * 0.8 + 0.2 * 0.5 + 0.2 * 0.9 + 0.1 * 0.8) / 0.85;
    expect(row.rank).toBeCloseTo(Math.round(expected * 1000) / 1000, 4);
    expect(res.rank_weights.mandatory).toBe(0.35);
  });

  it("an unmet mandatory gate blocks ranking entirely", () => {
    const res = buildCandidateComparison({
      req,
      applicants,
      candidates,
      fits: new Map([["t1", fitFor({ mandatory_gate: { met: false, unmet_skills: ["Go"] } })]]),
    });
    const row = res.rows.find((r) => r.twin_id === "t1")!;
    expect(row.rank_tier).toBe("gated");
    expect(row.rank).toBeNull();
  });

  it("insufficient evidence is its own state, never a zero rank", () => {
    const res = buildCandidateComparison({
      req,
      applicants,
      candidates,
      fits: new Map([
        [
          "t1",
          fitFor({
            scoring: {
              requirements: [{ skill: "Go", relationship: "none", verified_contribution: 0, contribution: 0 }],
              mandatory: { readiness: 0 },
              preferred: { readiness: null },
            },
            evidence_confidence: 0,
          }),
        ],
      ]),
    });
    const row = res.rows.find((r) => r.twin_id === "t1")!;
    expect(row.rank_tier).toBe("insufficient");
    expect(row.rank).toBeNull();
  });

  it("unknown interview/work-sample results are never scored as zero", () => {
    const res = buildCandidateComparison({
      req,
      applicants,
      candidates,
      fits: new Map([["t1", fitFor({})]]),
      signals: new Map([
        ["t1", { work_sample: null, work_sample_reviewed: false, knowledge: null, knowledge_reviewed: false, interview_score: null, interview_status: "none", assessment_submitted: false }],
      ]),
    });
    const row = res.rows.find((r) => r.twin_id === "t1")!;
    expect(row.rank).not.toBeNull(); // still ranked from fit-only components
    expect(row.rank_components.interview).toBeNull();
  });

  it("ties on the composite get a deterministic reason", () => {
    const mk = (twinId: string, conf: number) => ({
      twin_id: twinId,
      stage: "final_round",
      version: 1,
      application_code: `WS-${twinId}`,
      applied_at: "2026-09-01T09:00:00Z",
    });
    const fits = new Map([
      ["t1", fitFor({ evidence_confidence: 0.8 })],
      ["t3", fitFor({ evidence_confidence: 0.8 })],
    ]);
    const res = buildCandidateComparison({
      req: { ...req, audit_events: [] },
      applicants: [mk("t1", 0.8), mk("t3", 0.8)],
      candidates,
      fits,
    });
    const [a, b] = res.rows;
    expect(a.rank).toBeCloseTo(b.rank ?? -1, 5);
    expect(b.tie_reason).toContain("Same composite");
  });

  it("reports the fairness/audit panel with excluded protected attributes", () => {
    const res = buildCandidateComparison({ req, applicants, candidates, fits: new Map() });
    expect(res.fairness.excluded_attributes).toContain("name");
    expect(res.fairness.statement).toContain("Protected");
  });
});
