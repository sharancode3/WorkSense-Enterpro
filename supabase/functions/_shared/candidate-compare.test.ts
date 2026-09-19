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
