import { describe, expect, it } from "vitest";
import {
  computeReviewIndex,
  REVIEW_WEIGHTS,
  reviewSourceHash,
  type ReviewIndexInput,
} from "./workforce-review-index.ts";

const baseInput = (over: Partial<ReviewIndexInput> = {}): ReviewIndexInput => ({
  promotion_lag_months: 0,
  attendance: { baseline: 0.3, recent: 0.3 },
  delivery: { missed: 0, total: 8 },
  observations: [],
  seeks_growth: false,
  ...over,
});

const obs = (metric: string, values: { period: string; value: number; missing?: boolean }[]) =>
  values.map((v) => ({ metric, period: v.period, value: v.missing ? null : v.value, missing: v.missing ?? false }));

describe("workforce-review-index (Phase 9)", () => {
  it("weights sum to exactly 1.0, so the index scale is 0-100", () => {
    const sum = Object.values(REVIEW_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10); // IEEE-754: 0.3*3+0.1 = 0.99999... -> "consistent scale" claim is exact enough
    expect(Math.round(sum * 100)).toBe(100);
  });

  it("a fully saturated case reaches 100, never above", () => {
    const r = computeReviewIndex(
      baseInput({
        promotion_lag_months: 200,
        attendance: { baseline: 0.5, recent: 5 }, // ratio >> cap
        delivery: { missed: 8, total: 8 },
        observations: obs("engagement", [
          { period: "2026-01", value: 5 },
          { period: "2026-02", value: 5 },
          { period: "2026-03", value: 5 },
          { period: "2026-04", value: 0 },
          { period: "2026-05", value: 0 },
          { period: "2026-06", value: 0 },
        ]),
      })
    );
    expect(r.index).toBe(100);
    expect(r.index).toBeLessThanOrEqual(100);
  });

  it("a clean profile scores 0 (no manufactured risk from nothing)", () => {
    const r = computeReviewIndex(baseInput());
    expect(r.index).toBe(0);
    expect(r.priority).toBe("low");
  });

  it("zero attendance baseline produces a moderate fixed step, never an extreme ratio", () => {
    const zeroBase = computeReviewIndex(baseInput({ attendance: { baseline: 0, recent: 0.3 } }));
    expect(zeroBase.factors.attendance.score).toBe(0.5); // documented fixed step
    // Contrast: a real doubling from a positive baseline is a full factor.
    const doubling = computeReviewIndex(baseInput({ attendance: { baseline: 0.5, recent: 1.0 } }));
    expect(doubling.factors.attendance.score).toBe(1);
    // And a small ratio from a tiny baseline is bounded by the cap.
    const tiny = computeReviewIndex(baseInput({ attendance: { baseline: 0.02, recent: 0.6 } }));
    expect(tiny.factors.attendance.score).toBe(1); // 30x -> capped, not beyond scale
  });

  it("missing observations lower completeness but never raise the index", () => {
    const full = computeReviewIndex(
      baseInput({
        observations: obs("engagement", [
          { period: "2026-01", value: 4 },
          { period: "2026-02", value: 4 },
        ]),
      })
    );
    const sparse = computeReviewIndex(
      baseInput({
        observations: obs("engagement", [
          { period: "2026-01", value: 4, missing: true },
          { period: "2026-02", value: 4, missing: true },
        ]),
      })
    );
    expect(sparse.data_completeness).toBeLessThan(full.data_completeness);
    expect(sparse.index).toBeLessThanOrEqual(full.index);
    expect(sparse.missing_data.length).toBeGreaterThan(0);
  });

  it("seeking growth never contributes to the index", () => {
    const plain = computeReviewIndex(baseInput());
    const growth = computeReviewIndex(baseInput({ seeks_growth: true }));
    expect(growth.index).toBe(plain.index); // identical score
    expect(growth.seeking_growth).toBe(true); // but reported separately
    expect(growth.recommended_fact_finding.some((f) => f.includes("growth conversation"))).toBe(true);
  });

  it("priority tiers: top tier requires >= 75% data completeness", () => {
    const saturated = baseInput({
      promotion_lag_months: 200,
      attendance: { baseline: 0.5, recent: 5 },
      delivery: { missed: 8, total: 8 },
    });
    const noObs = computeReviewIndex(saturated);
    expect(noObs.index).toBeGreaterThanOrEqual(75);
    // Without observations, completeness is 0 -> capped below the top tier.
    expect(noObs.priority).toBe("high");
    expect(noObs.priority_gate.tier_capped).toBe(true);

    const withObs = computeReviewIndex({
      ...saturated,
      observations: obs("engagement", [
        { period: "2026-01", value: 4 },
        { period: "2026-02", value: 3 },
      ]),
    });
    expect(withObs.priority).toBe("review");
    expect(withObs.priority_gate.tier_capped).toBe(false);
  });

  it("trend reports direction per metric and marks thin data insufficient", () => {
    const r = computeReviewIndex(
      baseInput({
        observations: [
          ...obs("attendance", [
            { period: "2026-01", value: 0.2 },
            { period: "2026-02", value: 0.2 },
            { period: "2026-03", value: 0.5 },
            { period: "2026-04", value: 0.6 },
            { period: "2026-05", value: 0.7 },
            { period: "2026-06", value: 0.8 },
          ]),
          ...obs("engagement", [{ period: "2026-01", value: 4 }, { period: "2026-02", value: 3.5 }]),
        ],
      })
    );
    const att = r.trend.find((t) => t.metric === "attendance")!;
    expect(att.direction).toBe("up"); // absences rising
    const eng = r.trend.find((t) => t.metric === "engagement")!;
    expect(eng.direction).toBe("insufficient"); // < 2*half periods
    expect(r.recommended_fact_finding.some((f) => f.includes("1:1"))).toBe(true);
  });

  it("sensitivity flags are set for individual-level signals", () => {
    const r = computeReviewIndex(
      baseInput({
        attendance: { baseline: 0.5, recent: 1.2 },
        observations: obs("engagement", [
          { period: "2026-01", value: 4 },
          { period: "2026-02", value: 3 },
        ]),
      })
    );
    expect(r.sensitivity.individual_absence).toBe(true);
    expect(r.sensitivity.individual_engagement).toBe(true);
  });

  it("source hash is stable for identical input and changes when data changes", () => {
    const a = baseInput({ promotion_lag_months: 12 });
    const b = baseInput({ promotion_lag_months: 12 });
    expect(reviewSourceHash(a)).toBe(reviewSourceHash(b));
    expect(reviewSourceHash(baseInput({ promotion_lag_months: 12 }))).not.toBe(reviewSourceHash(baseInput({ promotion_lag_months: 13 })));
    const withObs = baseInput({ observations: obs("engagement", [{ period: "2026-01", value: 4 }]) });
    expect(reviewSourceHash(withObs)).not.toBe(reviewSourceHash(a));
  });

  it("documented limitations always label the index as not-a-probability", () => {
    const r = computeReviewIndex(baseInput());
    expect(r.limitations.some((l) => l.includes("NOT a probability"))).toBe(true);
  });
});
