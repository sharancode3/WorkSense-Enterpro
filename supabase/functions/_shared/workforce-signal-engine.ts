// ---------------------------------------------------------------------------
// Workforce Review Signal engine — deterministic, zero LLM.
// This is the PS's "Attrition Prediction System" built as decision SUPPORT.
// Internally the field is `risk_score`; every user-facing label says
// "Workforce Review Signal: NN/100 — Multiple workforce indicators warrant
// HR review". Never phrased as a prediction about a person's intent.
// ---------------------------------------------------------------------------

export interface WorkforceSignalInput {
  promotion_lag_months: number; // months in current band without promotion
  promotion_threshold_months?: number; // ~3 years = 36
  attendance: { baseline: number; recent: number }; // unapproved absences / month
  delivery: { missed: number; total: number }; // missed milestones / blocked tasks
  seeks_growth: boolean; // performance-review flag set when seeding, not derived live
}

export interface WorkforceSignalResult {
  risk_score: number; // 0-100, what the UI shows
  signal: number; // 0-1
  factors: { tenure: number; attendance: number; delivery: number; growth: number };
}

// Validated weights — keep the total ≤ 1.0 (0.18 reserved for a future 4th signal).
export const SIGNAL_WEIGHTS = { tenure: 0.28, attendance: 0.2, delivery: 0.22, growth: 0.12 } as const;
export const ATTENDANCE_CAP_RATIO = 2; // doubling absences vs baseline = full factor

export function computeWorkforceSignal(input: WorkforceSignalInput): WorkforceSignalResult {
  const threshold = input.promotion_threshold_months ?? 36;

  // F_tenure: 1 if time-in-band exceeds ~3 years without promotion, scaled otherwise.
  const F_tenure = Math.min(1, Math.max(0, input.promotion_lag_months) / threshold);

  // F_attendance: deviation of RECENT unapproved absence pattern from the
  // person's OWN rolling baseline (pattern change, never cross-person counts).
  const baseline = Math.max(0, input.attendance?.baseline ?? 0);
  const recent = Math.max(0, input.attendance?.recent ?? 0);
  let F_attendance = 0;
  if (baseline <= 0) {
    F_attendance = recent > 0 ? 1 : 0; // any unapproved absence where none existed before
  } else if (recent > baseline) {
    F_attendance = Math.min(1, (recent / baseline - 1) / (ATTENDANCE_CAP_RATIO - 1));
  }

  // F_delivery: recent missed milestones / blocked tasks ratio.
  const total = Math.max(0, input.delivery?.total ?? 0);
  const missed = Math.max(0, Math.min(total, input.delivery?.missed ?? 0));
  const F_delivery = total > 0 ? missed / total : 0;

  // F_growth: seeded flag "seeks more scope/leadership".
  const F_growth = input.seeks_growth ? 1 : 0;

  const signal = Math.min(
    1,
    SIGNAL_WEIGHTS.tenure * F_tenure +
      SIGNAL_WEIGHTS.attendance * F_attendance +
      SIGNAL_WEIGHTS.delivery * F_delivery +
      SIGNAL_WEIGHTS.growth * F_growth
  );

  return {
    risk_score: Math.round(signal * 100),
    signal,
    factors: { tenure: F_tenure, attendance: F_attendance, delivery: F_delivery, growth: F_growth },
  };
}
