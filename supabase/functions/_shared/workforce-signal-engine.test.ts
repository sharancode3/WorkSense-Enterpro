import { describe, expect, it } from "vitest";
import { computeWorkforceSignal, SIGNAL_WEIGHTS } from "./workforce-signal-engine.ts";

describe("Workforce Review Signal (deterministic)", () => {
  it("computes the exact weighted formula", () => {
    const res = computeWorkforceSignal({
      promotion_lag_months: 40, // > 36 -> tenure factor 1
      attendance: { baseline: 0.5, recent: 1.5 }, // 3x -> capped attendance factor 1
      delivery: { missed: 3, total: 8 }, // 0.375
      seeks_growth: true,
    });
    const expected = SIGNAL_WEIGHTS.tenure * 1 + SIGNAL_WEIGHTS.attendance * 1 + SIGNAL_WEIGHTS.delivery * 0.375 + SIGNAL_WEIGHTS.growth * 1;
    expect(res.signal).toBeCloseTo(expected, 4);
    expect(res.risk_score).toBe(68);
    expect(res.factors).toMatchObject({ tenure: 1, attendance: 1, delivery: 0.375, growth: 1 });
  });

  it("scales tenure below the ~3-year band", () => {
    const res = computeWorkforceSignal({
      promotion_lag_months: 18,
      attendance: { baseline: 0.3, recent: 0.3 },
      delivery: { missed: 0, total: 3 },
      seeks_growth: false,
    });
    expect(res.factors.tenure).toBeCloseTo(18 / 36, 4);
    expect(res.factors.attendance).toBe(0);
  });

  it("measures attendance as pattern change vs own baseline, never cross-person", () => {
    const flat = computeWorkforceSignal({
      promotion_lag_months: 0,
      attendance: { baseline: 0.5, recent: 0.5 },
      delivery: { missed: 0, total: 3 },
      seeks_growth: false,
    });
    expect(flat.factors.attendance).toBe(0);

    const doubled = computeWorkforceSignal({
      promotion_lag_months: 0,
      attendance: { baseline: 0.4, recent: 0.8 },
      delivery: { missed: 0, total: 3 },
      seeks_growth: false,
    });
    expect(doubled.factors.attendance).toBeCloseTo(1, 4);

    const fromZero = computeWorkforceSignal({
      promotion_lag_months: 0,
      attendance: { baseline: 0, recent: 0.4 },
      delivery: { missed: 0, total: 3 },
      seeks_growth: false,
    });
    expect(fromZero.factors.attendance).toBe(1);
  });

  it("uses the missed/total ratio for delivery", () => {
    const res = computeWorkforceSignal({
      promotion_lag_months: 0,
      attendance: { baseline: 0.3, recent: 0.2 },
      delivery: { missed: 4, total: 10 },
      seeks_growth: false,
    });
    expect(res.factors.delivery).toBeCloseTo(0.4, 4);
  });

  it("caps the signal at the weight total (0.82) — 0.18 is reserved per spec", () => {
    const res = computeWorkforceSignal({
      promotion_lag_months: 999,
      attendance: { baseline: 0.5, recent: 5 },
      delivery: { missed: 10, total: 10 },
      seeks_growth: true,
    });
    const weightTotal = SIGNAL_WEIGHTS.tenure + SIGNAL_WEIGHTS.attendance + SIGNAL_WEIGHTS.delivery + SIGNAL_WEIGHTS.growth;
    expect(weightTotal).toBeLessThanOrEqual(1); // spec: keep total capped at 1.0
    expect(res.signal).toBeCloseTo(weightTotal, 4);
    expect(res.risk_score).toBe(82);
  });

  it("returns 0 for a stable, growing employee", () => {
    const res = computeWorkforceSignal({
      promotion_lag_months: 6,
      attendance: { baseline: 0.3, recent: 0.2 },
      delivery: { missed: 0, total: 4 },
      seeks_growth: false,
    });
    expect(res.risk_score).toBeLessThanOrEqual(5);
  });
});
