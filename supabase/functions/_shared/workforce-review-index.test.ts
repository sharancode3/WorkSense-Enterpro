import { describe, expect, it } from "vitest";
import {
  computeReviewIndex,
  reviewBandFor,
  REVIEW_BANDS,
  REVIEW_BAND_LABELS,
  REVIEW_METRIC_FAVORABLE_DIRECTION,
  REVIEW_MODEL_STATUS,
  REVIEW_WEIGHTS,
  reviewSourceHash,
  STALE_OBSERVATION_MONTHS,
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

  it("priority tiers: top tier requires >= 75% data completeness AND adequate history", () => {
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

    // Two observation periods still = partial history -> capped off the top tier.
    const partialObs = computeReviewIndex({
      ...saturated,
      observations: obs("engagement", [
        { period: "2026-01", value: 4 },
        { period: "2026-02", value: 3 },
      ]),
    });
    expect(partialObs.history_state).toBe("partial");
    expect(partialObs.priority).toBe("high");
    expect(partialObs.priority_gate.tier_capped).toBe(true);

    // Adequate history (>=3 distinct present periods) + high completeness -> top tier.
    const withObs = computeReviewIndex({
      ...saturated,
      observations: obs("engagement", [
        { period: "2026-01", value: 4 },
        { period: "2026-02", value: 3 },
        { period: "2026-03", value: 3 },
        { period: "2026-04", value: 3 },
      ]),
    });
    expect(withObs.history_state).toBe("adequate");
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

describe("workforce-review-index (Phase 7 — defensibility)", () => {
  it("review bands match the priority logic and are the same everywhere", () => {
    // Canonical band boundaries.
    expect(reviewBandFor(0)).toBe("low");
    expect(reviewBandFor(39)).toBe("low");
    expect(reviewBandFor(40)).toBe("medium");
    expect(reviewBandFor(59)).toBe("medium");
    expect(reviewBandFor(60)).toBe("high");
    expect(reviewBandFor(74)).toBe("high");
    expect(reviewBandFor(75)).toBe("review");
    expect(reviewBandFor(100)).toBe("review");
    // A fully-data-saturated case that reaches "review" stays in the review band.
    const r = computeReviewIndex(
      baseInput({
        promotion_lag_months: 200,
        attendance: { baseline: 0.5, recent: 5 },
        delivery: { missed: 8, total: 8 },
        observations: obs("engagement", [
          { period: "2026-01", value: 5 }, { period: "2026-02", value: 5 },
          { period: "2026-03", value: 5 }, { period: "2026-04", value: 0 },
          { period: "2026-05", value: 0 }, { period: "2026-06", value: 0 },
        ]),
      })
    );
    expect(r.priority).toBe("review");
    expect(reviewBandFor(r.index)).toBe("review");
    // Bands themselves are contiguous and ascending.
    expect(REVIEW_BANDS.low.max + 1).toBe(REVIEW_BANDS.medium.min);
    expect(REVIEW_BANDS.medium.max + 1).toBe(REVIEW_BANDS.high.min);
    expect(REVIEW_BANDS.high.max + 1).toBe(REVIEW_BANDS.review.min);
    expect(Object.keys(REVIEW_BAND_LABELS).length).toBe(4);
  });

  it("zero-history case is honestly represented: capped priority, low confidence, critical data quality", () => {
    const r = computeReviewIndex(baseInput({ promotion_lag_months: 200, attendance: { baseline: 0.5, recent: 5 }, delivery: { missed: 8, total: 8 } }));
    expect(r.index).toBeGreaterThanOrEqual(75);
    expect(r.priority).toBe("high"); // honestly capped (not "review") with zero history
    expect(r.priority_gate.tier_capped).toBe(true);
    expect(r.priority_gate.reason).toContain("zero longitudinal observation history");
    expect(r.history_state).toBe("none");
    expect(r.confidence).toBe("low");
    expect(r.data_quality.severity).toBe("critical");
    expect(r.data_quality.issues.some((i) => i.kind === "zero_history")).toBe(true);
    expect(r.freshness.oldest_observation_period).toBeNull();
  });

  it("distinguishes insufficient history from stable behavior", () => {
    const thin = computeReviewIndex(baseInput({
      computed_at: "2026-07-15T00:00:00Z",
      observations: obs("engagement", [{ period: "2026-01", value: 4 }, { period: "2026-02", value: 3.5 }]),
    }));
    expect(thin.history_state).toBe("partial");
    expect(thin.trend.find((t) => t.metric === "engagement")?.direction).toBe("insufficient");
    expect(thin.confidence).toBe("medium");

    const stable = computeReviewIndex(baseInput({
      computed_at: "2026-07-15T00:00:00Z",
      observations: obs("engagement", [
        { period: "2026-01", value: 4 }, { period: "2026-02", value: 4 }, { period: "2026-03", value: 4 },
        { period: "2026-04", value: 4 }, { period: "2026-05", value: 4 }, { period: "2026-06", value: 4 },
      ]),
    }));
    expect(stable.history_state).toBe("adequate");
    expect(stable.trend.find((t) => t.metric === "engagement")?.direction).toBe("flat");
    expect(stable.confidence).toBe("high");
  });

  it("trends carry correct favorable/unfavorable semantics per metric", () => {
    const r = computeReviewIndex(baseInput({
      observations: [
        ...obs("attendance", [
          { period: "2026-01", value: 0.2 }, { period: "2026-02", value: 0.3 },
          { period: "2026-03", value: 0.5 }, { period: "2026-04", value: 0.6 },
          { period: "2026-05", value: 0.7 }, { period: "2026-06", value: 0.8 },
        ]),
        ...obs("delivery", [
          { period: "2026-01", value: 0.7 }, { period: "2026-02", value: 0.75 },
          { period: "2026-03", value: 0.8 }, { period: "2026-04", value: 0.85 },
          { period: "2026-05", value: 0.9 }, { period: "2026-06", value: 0.95 },
        ]),
        ...obs("engagement", [
          { period: "2026-01", value: 4 }, { period: "2026-02", value: 3.8 },
          { period: "2026-03", value: 3.5 }, { period: "2026-04", value: 3.2 },
          { period: "2026-05", value: 3 }, { period: "2026-06", value: 2.8 },
        ]),
      ],
    }));
    const att = r.trend.find((t) => t.metric === "attendance")!;
    const del = r.trend.find((t) => t.metric === "delivery")!;
    const eng = r.trend.find((t) => t.metric === "engagement")!;
    // attendance rising is UNfavorable; delivery rising is favorable; engagement falling is UNfavorable.
    expect(att.favorable_direction).toBe("down");
    expect(att.favorable).toBe(false);
    expect(del.favorable_direction).toBe("up");
    expect(del.favorable).toBe(true);
    expect(eng.favorable_direction).toBe("up");
    expect(eng.favorable).toBe(false);
    // Canonical map agrees.
    expect(REVIEW_METRIC_FAVORABLE_DIRECTION).toEqual({ attendance: "down", delivery: "up", engagement: "up" });
  });

  it("explains why a conversation is suggested (case rationale per factor)", () => {
    const r = computeReviewIndex(baseInput({ promotion_lag_months: 40, attendance: { baseline: 0.3, recent: 1.0 } }));
    const rationales = r.case_rationale.map((c) => c.factor);
    expect(rationales).toContain("career");
    expect(r.case_rationale.every((c) => c.why.trim().length > 0)).toBe(true);
  });

  it("flags stale observations and lowers confidence accordingly", () => {
    const r = computeReviewIndex(baseInput({
      computed_at: "2026-09-15T00:00:00Z",
      observations: obs("engagement", [{ period: "2025-01", value: 4 }, { period: "2025-02", value: 4 }]),
    }));
    expect(r.freshness.stale).toBe(true);
    expect(r.freshness.months_since_latest).toBeGreaterThan(STALE_OBSERVATION_MONTHS);
    expect(r.confidence).toBe("low");
    expect(r.data_quality.issues.some((i) => i.kind === "stale_observations")).toBe(true);
  });

  it("never claims a validated predictive model exists", () => {
    expect(REVIEW_MODEL_STATUS.has_validated_predictive_model).toBe(false);
    expect(REVIEW_MODEL_STATUS.label.toLowerCase()).toContain("not a probability");
    expect(REVIEW_MODEL_STATUS.future_ml_requirements.length).toBeGreaterThanOrEqual(6);
  });

  it("AUDIT INVARIANT: a zero-history worker is never a normal HIGH/REVIEW band", () => {
    // Leila-style: high snapshot factors, ZERO longitudinal observations.
    const r = computeReviewIndex(
      baseInput({
        promotion_lag_months: 60, // full career factor
        attendance: { baseline: 0.3, recent: 1.5 }, // materially above own baseline
        delivery: { missed: 8, total: 8 },
        observations: [], // NO history
      })
    );
    expect(r.index).toBeGreaterThanOrEqual(75); // raw index qualifies for top tier
    expect(r.history_state).toBe("none");
    expect(r.priority).not.toBe("review"); // capped off the top tier
    expect(r.priority_gate.tier_capped).toBe(true);
    expect(r.confidence).toBe("low");
    expect(r.data_quality.issues.some((i) => i.kind === "zero_history")).toBe(true);
  });

  it("AUDIT INVARIANT: adequate history + completeness is required before longitudinal priority", () => {
    const r = computeReviewIndex(
      baseInput({
        promotion_lag_months: 60,
        attendance: { baseline: 0.3, recent: 1.5 },
        delivery: { missed: 6, total: 8 },
        observations: obs("engagement", [
          { period: "2026-01", value: 4 }, { period: "2026-02", value: 4 },
          { period: "2026-03", value: 4 }, { period: "2026-04", value: 2 },
        ]),
      })
    );
    expect(r.history_state).toBe("adequate");
    expect(r.priority).toBe("review"); // evidence-backed case CAN reach the top tier
    expect(r.priority_gate.tier_capped).toBe(false);
    expect(r.confidence).not.toBe("low");
  });

  it("AUDIT INVARIANT: partial history caps the top tier and is labeled insufficient history", () => {
    const r = computeReviewIndex(
      baseInput({
        promotion_lag_months: 60,
        attendance: { baseline: 0.3, recent: 1.5 },
        delivery: { missed: 8, total: 8 },
        observations: obs("engagement", [
          { period: "2026-04", value: 4 }, { period: "2026-05", value: 2 },
        ]),
      })
    );
    expect(r.history_state).toBe("partial");
    expect(r.priority).toBe("high"); // capped from review
    expect(r.priority_gate.tier_capped).toBe(true);
  });
});

