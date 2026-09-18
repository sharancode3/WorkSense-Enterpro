import { describe, expect, it } from "vitest";
import { appendAuditEvent, mergeLegacyFits, type FitLike } from "./fit-store";

describe("fit-store legacy mirror helpers (Batch 6)", () => {
  const cur: FitLike = { target_type: "requisition", target_id: "r1", scenario: "current", score: 0.8 };
  const fut: FitLike = { target_type: "requisition", target_id: "r1", scenario: "future", score: 0.9 };
  const other: FitLike = { target_type: "requisition", target_id: "r2", scenario: "current", score: 0.5 };

  it("replaces the fit for the same target+scenario and preserves others", () => {
    const merged = mergeLegacyFits([cur, other, fut], { ...cur, score: 0.85 });
    expect(merged).toHaveLength(3);
    const current = merged.find((f) => f.target_id === "r1" && f.scenario === "current");
    expect(current?.score).toBe(0.85);
    expect(merged.some((f) => f.target_id === "r2" && f.scenario === "current")).toBe(true);
  });

  it("never loses concurrent recomputes for a different target (idempotent merge)", () => {
    const first = mergeLegacyFits([], { ...cur, score: 0.7 });
    const second = mergeLegacyFits(first, other);
    expect(second).toHaveLength(2);
  });

  it("appends audit events without clobbering history", () => {
    const prior = [{ actor: "seed", action: "plan_generated", timestamp: "2026-01-01" }];
    const next = appendAuditEvent(prior, { actor: "dana", action: "assessment_reviewed", timestamp: "2026-09-18" });
    expect(next).toHaveLength(2);
    expect(prior).toHaveLength(1);
  });
});
