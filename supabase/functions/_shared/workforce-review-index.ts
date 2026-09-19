// ---------------------------------------------------------------------------
// Workforce Review Index engine — deterministic, zero LLM.
// An interpretable, decision-support composite (0-100) that flags WHEN a
// manager/HR review conversation is warranted. It is a REVIEW INDEX, never a
// probability of leaving, and never a performance verdict on its own.
//
// Documented design (Phase 9 baseline, Phase 7 hardened):
// - Factor weights sum to EXACTLY 1.0 (max index = 100).
// - Missing observations are gaps that reduce data completeness; they never
//   count as poor performance and never push anyone into the top tier.
// - A zero attendance baseline does NOT produce an extreme ratio: an absence
//   pattern appearing where none was recorded scores a fixed moderate step.
// - Seeking growth / development interest is reported SEPARATELY and never
//   contributes to the index (growth interest != intent to leave).
// - Priority tiers: low < 40, medium 40-59, high 60-74, review >= 75 (the
//   top tier additionally requires >= REVIEW_MIN_COMPLETENESS data).
// - Phase 7: observed factors, coverage, freshness and review confidence are
//   reported SEPARATELY. Data-quality problems surface BEFORE classification
//   (flags + severity + confidence), insufficient history is distinguished
//   from stable behavior (history_state), and every trend carries explicit
//   favorable/unfavorable semantics. No validated predictive model exists:
//   REVIEW_MODEL_STATUS documents what a future attrition model would require.
// ---------------------------------------------------------------------------

export interface ReviewObservation {
  metric: string; // attendance | engagement | delivery | availability
  period: string; // YYYY-MM
  value: number | null;
  missing: boolean;
}

export interface ReviewIndexInput {
  twin_id?: string;
  promotion_lag_months: number; // months in current band without promotion
  promotion_threshold_months?: number; // default 36 (career-review horizon)
  attendance?: { baseline?: number | null; recent?: number | null }; // unapproved absences/month snapshot
  delivery?: { missed?: number | null; total?: number | null }; // missed milestones / window total
  observations?: ReviewObservation[]; // period-scoped, explicit missing flag
  seeks_growth?: boolean; // self-reported development interest — NEVER adds risk
  engagement_window_months?: number; // default 6
  computed_at?: string; // ISO timestamp for freshness computations
}

export interface ReviewFactor {
  score: number; // 0-1
  weight: number; // factor weight (weights sum to 1.0)
  definition: string; // plain-language factor definition
  source_period: string | null; // evidence period used (or null when n/a)
  note: string | null; // caveat / data-state note
  /** Phase 7: coverage of the evidence this factor relies on (0-1). */
  coverage: number;
  /** Phase 7: how fresh the factor's evidence is (latest period used, or null). */
  freshness: string | null;
}

export interface ReviewTrend {
  metric: string;
  direction: "up" | "down" | "flat" | "insufficient";
  delta: number | null; // (last-first)/first on present values
  first: number | null;
  last: number | null;
  periods: string[];
  /** Phase 7: canonical direction that counts as favorable for this metric. */
  favorable_direction: "up" | "down";
  /** Phase 7: whether the observed change is favorable for the metric. */
  favorable: boolean;
}

/** Phase 7: review confidence — how much the index can be trusted given the
 *  data, NOT a probability of leaving and NOT model calibration. */
export type ReviewConfidence = "high" | "medium" | "low";

export interface DataQualityIssue {
  kind: string; // missing_periods | stale_observations | zero_history | snapshot_only
  detail: string;
}

export interface ReviewIndexResult {
  index: number; // 0-100, weights sum to 1.0
  factors: Record<"career" | "attendance" | "delivery" | "engagement", ReviewFactor>;
  trend: ReviewTrend[];
  data_completeness: number; // 0-1 fraction of expected observation slots present
  missing_data: { metric: string; periods: string[] }[];
  seeking_growth: boolean; // reported separately; NOT part of the index
  priority: "low" | "medium" | "high" | "review";
  priority_gate: { tier_capped: boolean; reason: string | null };
  recommended_fact_finding: string[];
  sensitivity: { individual_absence: boolean; individual_engagement: boolean };
  limitations: string[];
  // Phase 7 additions:
  confidence: ReviewConfidence;
  confidence_reason: string;
  history_state: "none" | "partial" | "adequate";
  data_quality: { issues: DataQualityIssue[]; severity: "ok" | "warning" | "critical" };
  freshness: {
    oldest_observation_period: string | null;
    latest_observation_period: string | null;
    months_since_latest: number | null;
    stale: boolean;
    computed_at: string;
  };
  case_rationale: { factor: string; why: string }[];
}

/** Canonical review bands — the single source of truth the UI and backend both
 *  use so "review bands match across UI and backend". */
export const REVIEW_BANDS: Record<"low" | "medium" | "high" | "review", { min: number; max: number }> = {
  low: { min: 0, max: 39 },
  medium: { min: 40, max: 59 },
  high: { min: 60, max: 74 },
  review: { min: 75, max: 100 },
};

export const REVIEW_BAND_LABELS: Record<keyof typeof REVIEW_BANDS, string> = {
  low: "Low (0-39)",
  medium: "Medium (40-59)",
  high: "High (60-74)",
  review: "Review (75-100)",
};

/** Map an index value to its canonical band (backend + UI agree on this). */
export function reviewBandFor(index: number): "low" | "medium" | "high" | "review" {
  if (index >= REVIEW_BANDS.review.min) return "review";
  if (index >= REVIEW_BANDS.high.min) return "high";
  if (index >= REVIEW_BANDS.medium.min) return "medium";
  return "low";
}

/** Phase 7: per-metric semantics so trends are rendered with the CORRECT
 *  favorable/unfavorable meaning (attendance up = bad; delivery/engagement
 *  up = good). */
export const REVIEW_METRIC_FAVORABLE_DIRECTION: Record<string, "up" | "down"> = {
  attendance: "down",
  delivery: "up",
  engagement: "up",
};

export type ReviewBand = "low" | "medium" | "high" | "review";

/** Phase 7: fewer distinct present periods than this = "insufficient history"
 *  (distinct from stable behavior, which requires enough data to actually be flat). */
export const REVIEW_HISTORY_MIN_PERIODS = 3;
/** Phase 7: latest observation older than this many months = stale. */
export const STALE_OBSERVATION_MONTHS = 6;

/** Phase 7 — honest model status. No validated attrition/predictive model
 *  exists; this is the (unchanged) honest REVIEW INDEX terminology the spec
 *  asks to preserve. The future-ML checklist (spec items 21-26) is documented
 *  here so nobody mistakes the heuristic composite for a calibrated predictor. */
export const REVIEW_MODEL_STATUS = {
  has_validated_predictive_model: false,
  label: "Workforce Review Index — a documented heuristic composite (0-100), not a probability of leaving and not a calibrated prediction.",
  future_ml_requirements: [
    "21. Define an explicit outcome (e.g., voluntary attrition within a horizon) and a prediction horizon.",
    "22. Split by time (train on earlier periods, evaluate on later) and prevent post-outcome leakage.",
    "23. Compare against interpretable baselines (e.g., historical base rate) before any complex model.",
    "24. Report calibration, precision/recall, cohort stability and missingness handling.",
    "25. Clearly distinguish synthetic-data demonstrations from externally validated predictive performance.",
    "26. Keep any future prediction as restricted decision support, never automatic action.",
  ],
  note: "None of the above is implemented because no suitable labeled outcome dataset exists in this deployment. Until it does, every case stays a review index with documented heuristics.",
} as const;

// Weights — sum is exactly 1.0 (0.30 + 0.30 + 0.30 + 0.10).
export const REVIEW_WEIGHTS = { career: 0.3, attendance: 0.3, delivery: 0.3, engagement: 0.1 } as const;
export const CAREER_REVIEW_THRESHOLD_MONTHS = 36;
export const ATTENDANCE_CAP_RATIO = 2; // doubling the baseline absence rate = full factor
export const ZERO_BASELINE_STEP = 0.5; // fixed moderate step (NOT 1.0) when a pattern appears from zero
export const REVIEW_MIN_COMPLETENESS = 0.75; // top tier requires at least this much data
export const TREND_HALF_PERIODS = 3; // compare means of first/last N present periods

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function presentValues(obs: ReviewObservation[], metric: string): { period: string; value: number }[] {
  return (obs ?? [])
    .filter((o) => o.metric === metric && !o.missing && typeof o.value === "number")
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((o) => ({ period: o.period, value: o.value as number }));
}

export function computeReviewIndex(input: ReviewIndexInput): ReviewIndexResult {
  const threshold = input.promotion_threshold_months ?? CAREER_REVIEW_THRESHOLD_MONTHS;
  const engWindow = input.engagement_window_months ?? 6;
  const obs = input.observations ?? [];
  const seeksGrowth = input.seeks_growth === true;
  const computedAt = input.computed_at ?? new Date().toISOString();

  // --- F_career: time in band beyond the career-review horizon --------------
  const lag = Math.max(0, Number(input.promotion_lag_months) || 0);
  const career = clamp01(lag / threshold);
  const careerFactor: ReviewFactor = {
    score: career,
    weight: REVIEW_WEIGHTS.career,
    definition: `Months in current band without a promotion, scaled against the ${threshold}-month career-review horizon.`,
    source_period: "twin profile (as of computed_at)",
    coverage: 1,
    freshness: "profile snapshot",
    note: career >= 0.5 ? "Extended time in band warrants a career-path conversation — not, by itself, a risk conclusion." : null,
  };

  // --- F_attendance: deviation of recent absence rate from OWN baseline ------
  const base = input.attendance?.baseline;
  const recent = input.attendance?.recent;
  let attendanceScore = 0;
  let attendanceNote: string | null = null;
  const attendanceCoverage = base === null || base === undefined || recent === null || recent === undefined ? 0 : 1;
  if (attendanceCoverage === 0) {
    attendanceNote = "No absence snapshot recorded — treated as unknown, not penalized.";
  } else if (Number(base) > 0) {
    const b = Math.max(0, Number(base));
    const r = Math.max(0, Number(recent));
    if (r > b) {
      attendanceScore = clamp01((r / b - 1) / (ATTENDANCE_CAP_RATIO - 1));
      if (attendanceScore >= 0.5) attendanceNote = "Recent absence rate is materially above this person's own baseline — verify with the manager.";
    }
  } else {
    // Zero baseline: fixed moderate step, never an extreme ratio from 0.
    attendanceScore = Math.max(0, Number(recent)) > 0 ? ZERO_BASELINE_STEP : 0;
    if (attendanceScore > 0) {
      attendanceNote = `No unapproved absence was recorded before; a pattern appeared (scored a fixed ${ZERO_BASELINE_STEP} step to avoid an extreme ratio from a zero baseline).`;
    }
  }
  const attendanceFactor: ReviewFactor = {
    score: attendanceScore,
    weight: REVIEW_WEIGHTS.attendance,
    definition: "Deviation of the recent unapproved-absence rate from the person's own baseline (pattern change, never cross-person counts).",
    source_period: "most recent absence snapshot (HRIS)",
    coverage: attendanceCoverage,
    freshness: "HRIS snapshot",
    note: attendanceNote,
  };

  // --- F_delivery: missed milestones / window total --------------------------
  const total = Math.max(0, Number(input.delivery?.total) || 0);
  const missed = Math.max(0, Math.min(total, Number(input.delivery?.missed) || 0));
  const deliveryScore = total > 0 ? missed / total : 0;
  const deliveryFactor: ReviewFactor = {
    score: deliveryScore,
    weight: REVIEW_WEIGHTS.delivery,
    definition: "Missed milestones as a share of the review window's total — a workload/availability indicator, not a quality verdict.",
    source_period: "recent delivery window (missed/total)",
    coverage: total > 0 ? 1 : 0,
    freshness: "delivery window snapshot",
    note: total <= 0 ? "No delivery observations in window — treated as unknown, not penalized." : deliveryScore >= 0.5 ? "High miss share — investigate workload/resourcing before drawing conclusions." : null,
  };

  // --- F_engagement: trend over the observation window (explicit gaps) -------
  const eng = presentValues(obs, "engagement").slice(-engWindow);
  let engagementScore = 0;
  let engNote: string | null = null;
  if (eng.length < 2) {
    engNote = eng.length === 0 ? "No engagement observations — treated as unknown, not penalized." : "Too few engagement observations to score.";
  } else {
    const half = Math.max(1, Math.floor(eng.length / 2));
    const first = eng.slice(0, half).reduce((s, p) => s + p.value, 0) / half;
    const second = eng.slice(eng.length - half).reduce((s, p) => s + p.value, 0) / half;
    if (first > 0) {
      engagementScore = clamp01((first - second) / first); // decline in engagement raises the factor
      if (engagementScore > 0) engNote = "Engagement observations trend downward across the window.";
    }
  }
  const engagementFactor: ReviewFactor = {
    score: engagementScore,
    weight: REVIEW_WEIGHTS.engagement,
    definition: `Decline in engagement observations over the last ${engWindow} months (first-vs-second-half means). Missing periods are gaps, not poor performance.`,
    source_period: eng.length >= 2 ? `${eng[0].period} → ${eng[eng.length - 1].period}` : null,
    coverage: eng.length >= 2 ? 1 : eng.length === 1 ? 0.5 : 0,
    freshness: eng.length >= 2 ? eng[eng.length - 1].period : null,
    note: engNote,
  };

  // --- Composite index --------------------------------------------------------
  const index = Math.round(
    100 *
      (REVIEW_WEIGHTS.career * career +
        REVIEW_WEIGHTS.attendance * attendanceScore +
        REVIEW_WEIGHTS.delivery * deliveryScore +
        REVIEW_WEIGHTS.engagement * engagementScore)
  );

  // --- Data completeness + missing data --------------------------------------
  const metricsSeen = new Set((obs ?? []).map((o) => o.metric));
  const periodSet = new Set((obs ?? []).map((o) => o.period));
  const expected = metricsSeen.size * periodSet.size;
  const present = (obs ?? []).filter((o) => !o.missing && typeof o.value === "number").length;
  const data_completeness = expected > 0 ? present / expected : 0;

  const missingByMetric = new Map<string, string[]>();
  for (const o of obs ?? []) {
    if (o.missing || o.value === null || o.value === undefined) {
      missingByMetric.set(o.metric, [...(missingByMetric.get(o.metric) ?? []), o.period]);
    }
  }
  const missing_data = [...missingByMetric.entries()]
    .map(([metric, periods]) => ({ metric, periods: periods.sort() }))
    .sort((a, b) => a.metric.localeCompare(b.metric));

  // --- Freshness (Phase 7) ----------------------------------------------------
  const allPresent = (obs ?? [])
    .filter((o) => !o.missing && typeof o.value === "number")
    .map((o) => o.period)
    .sort();
  const oldest = allPresent[0] ?? null;
  const latest = allPresent[allPresent.length - 1] ?? null;
  let monthsSinceLatest: number | null = null;
  if (latest) {
    const [ly, lm] = latest.split("-").map(Number);
    const now = new Date(computedAt);
    monthsSinceLatest = (now.getUTCFullYear() - ly) * 12 + (now.getUTCMonth() + 1 - lm);
  }
  const stale = monthsSinceLatest !== null && monthsSinceLatest > STALE_OBSERVATION_MONTHS;

  // --- History state (Phase 7): insufficient history vs stable behavior ------
  const distinctPresentPeriods = new Set(allPresent).size;
  const history_state: ReviewIndexResult["history_state"] =
    distinctPresentPeriods === 0 ? "none" : distinctPresentPeriods < REVIEW_HISTORY_MIN_PERIODS ? "partial" : "adequate";

  // --- Data quality surfaced BEFORE classification (Phase 7) ------------------
  const issues: DataQualityIssue[] = [];
  if (distinctPresentPeriods === 0) {
    issues.push({ kind: "zero_history", detail: "No longitudinal observations exist — the index reflects profile snapshots only (career lag, absence and delivery snapshots)." });
  } else if (distinctPresentPeriods < REVIEW_HISTORY_MIN_PERIODS) {
    issues.push({ kind: "snapshot_only", detail: `Only ${distinctPresentPeriods} observation period(s) present — trends cannot be established yet.` });
  }
  if (missing_data.length > 0) {
    const missingCount = missing_data.reduce((n, m) => n + m.periods.length, 0);
    issues.push({ kind: "missing_periods", detail: `${missingCount} observation slot(s) missing across ${missing_data.length} metric(s).` });
  }
  if (stale) {
    issues.push({ kind: "stale_observations", detail: `Latest observation is ${monthsSinceLatest} months old (stale threshold: ${STALE_OBSERVATION_MONTHS}).` });
  }
  const severity: ReviewIndexResult["data_quality"]["severity"] =
    distinctPresentPeriods === 0 || data_completeness < 0.4 ? "critical" : data_completeness < REVIEW_MIN_COMPLETENESS || stale ? "warning" : "ok";

  // --- Review confidence (Phase 7): data-driven, explicitly not a probability --
  let confidence: ReviewConfidence;
  let confidence_reason: string;
  if (distinctPresentPeriods === 0 || data_completeness < 0.5 || stale) {
    confidence = "low";
    confidence_reason = `Low — longitudinal observation history is ${distinctPresentPeriods === 0 ? "absent" : "incomplete"} (${Math.round(data_completeness * 100)}% complete${stale ? ", stale" : ""}). Use the index as a starting point, not a signal.`;
  } else if (data_completeness < REVIEW_MIN_COMPLETENESS || distinctPresentPeriods < 6) {
    confidence = "medium";
    confidence_reason = `Medium — coverage is ${Math.round(data_completeness * 100)}% across ${distinctPresentPeriods} period(s); confirm with a conversation before any conclusion.`;
  } else {
    confidence = "high";
    confidence_reason = `High — coverage is ${Math.round(data_completeness * 100)}% across ${distinctPresentPeriods} period(s) and observations are fresh.`;
  }

  // --- Trend per metric (favorable/unfavorable semantics) ---------------------
  const trend: ReviewTrend[] = ["attendance", "engagement", "delivery"].map((metric) => {
    const vals = presentValues(obs, metric);
    const favorable_direction = REVIEW_METRIC_FAVORABLE_DIRECTION[metric] ?? "up";
    if (vals.length < 2 * TREND_HALF_PERIODS) {
      return { metric, direction: "insufficient", delta: null, first: null, last: null, periods: vals.map((v) => v.period), favorable_direction, favorable: false };
    }
    const firstMean = vals.slice(0, TREND_HALF_PERIODS).reduce((s, p) => s + p.value, 0) / TREND_HALF_PERIODS;
    const lastMean = vals.slice(-TREND_HALF_PERIODS).reduce((s, p) => s + p.value, 0) / TREND_HALF_PERIODS;
    const delta = firstMean > 0 ? (lastMean - firstMean) / firstMean : null;
    const eps = 0.03;
    const direction = delta === null || Math.abs(delta) < eps ? "flat" : delta > 0 ? "up" : "down";
    const favorable = direction === favorable_direction;
    return { metric, direction, delta, first: +firstMean.toFixed(3), last: +lastMean.toFixed(3), periods: vals.map((v) => v.period), favorable_direction, favorable };
  });

  // --- Priority tier (review index, not probability) -------------------------
  let priority: ReviewIndexResult["priority"] = "low";
  if (index >= 75) priority = "review";
  else if (index >= 60) priority = "high";
  else if (index >= 40) priority = "medium";

  let tierCapped = false;
  let gateReason: string | null = null;
  if (priority === "review" && history_state !== "adequate") {
    priority = "high";
    tierCapped = true;
    gateReason =
      history_state === "none"
        ? "The index qualifies for the top tier on profile snapshots alone, but there is zero longitudinal observation history — the case is honestly capped until history exists. It is not an alarming classification on no data."
        : `The index qualifies for the top tier, but longitudinal history is insufficient (${distinctPresentPeriods} of ${REVIEW_HISTORY_MIN_PERIODS} required periods). Missing history never escalates a case — collect observations before treating this as a top-priority review.`;
  } else if (priority === "review" && data_completeness < REVIEW_MIN_COMPLETENESS) {
    priority = "high";
    tierCapped = true;
    gateReason = `Index qualifies for the top tier, but observation data completeness is ${Math.round(data_completeness * 100)}% (min ${Math.round(REVIEW_MIN_COMPLETENESS * 100)}% required) — missing data never escalates a case; complete the gaps before treating this as a top-priority review.`;
  }

  // --- Recommended fact-finding (deterministic, action-oriented) -------------
  const recommended_fact_finding: string[] = [];
  const case_rationale: { factor: string; why: string }[] = [];
  if (attendanceScore >= 0.5) {
    recommended_fact_finding.push("Verify the unapproved-absence pattern with the employee's manager before any conclusion.");
    case_rationale.push({ factor: "attendance", why: attendanceNote ?? "The recent absence rate is materially above the person's own baseline." });
  }
  const engTrendDir = trend.find((t) => t.metric === "engagement")?.direction ?? "insufficient";
  if (engagementScore >= 0.5 || engTrendDir === "down" || engTrendDir === "insufficient") {
    recommended_fact_finding.push("Collect an engagement pulse and discuss drivers in a 1:1 — do not infer reasons from the numbers.");
    if (engTrendDir === "down") case_rationale.push({ factor: "engagement", why: "Engagement observations trend downward across the window." });
    else if (engTrendDir === "insufficient") case_rationale.push({ factor: "engagement", why: "Engagement history is insufficient to judge direction — a conversation is the only honest next step." });
  }
  if (career >= 0.5) {
    recommended_fact_finding.push("Open a career-path conversation; review band-change timing and growth options.");
    case_rationale.push({ factor: "career", why: `${Math.round(lag)} months in band without a promotion — beyond the ${threshold}-month career-review horizon.` });
  }
  if (deliveryScore >= 0.5) {
    recommended_fact_finding.push("Review workload and resourcing; distinguish missed deadlines caused by capacity from quality issues.");
    case_rationale.push({ factor: "delivery", why: `${Math.round(missed)} of ${Math.round(total)} milestones missed in the delivery window.` });
  }
  if (data_completeness < REVIEW_MIN_COMPLETENESS) {
    recommended_fact_finding.push(`Observation history is ${Math.round(data_completeness * 100)}% complete — collect the missing periods before finalizing the review.`);
  }
  if (seeksGrowth) {
    recommended_fact_finding.push("Reported development interest is a growth conversation, not a risk signal — plan scope/mentoring, do not flag for retention.");
  }

  return {
    index,
    factors: { career: careerFactor, attendance: attendanceFactor, delivery: deliveryFactor, engagement: engagementFactor },
    trend,
    data_completeness: +data_completeness.toFixed(3),
    missing_data,
    seeking_growth: seeksGrowth,
    priority,
    priority_gate: { tier_capped: tierCapped, reason: gateReason },
    recommended_fact_finding,
    sensitivity: { individual_absence: attendanceScore > 0, individual_engagement: eng.length >= 2 },
    limitations: [
      "Workforce Review Index is an interpretable decision-support composite (0-100), NOT a probability of leaving.",
      "Factor weights and definitions are fixed, documented heuristics; validate local assumptions before operational use.",
      "Missing observations are treated as data gaps (lower completeness), never as poor performance.",
      "Seeking-growth / development interest is reported separately and never contributes to the index.",
      "The attendance factor uses the most recent absence snapshot; confirm with the manager before conclusions.",
      "Review confidence reflects data coverage and freshness — it is not a calibrated model reliability measure.",
    ],
    confidence,
    confidence_reason,
    history_state,
    data_quality: { issues, severity },
    freshness: {
      oldest_observation_period: oldest,
      latest_observation_period: latest,
      months_since_latest: monthsSinceLatest,
      stale,
      computed_at: computedAt,
    },
    case_rationale,
  };
}

// Stable version hash over the index-relevant source rows. Used to detect when
// cached review artifacts must be invalidated because the underlying data changed.
export function reviewSourceHash(input: ReviewIndexInput): string {
  const payload = {
    lag: input.promotion_lag_months,
    threshold: input.promotion_threshold_months ?? CAREER_REVIEW_THRESHOLD_MONTHS,
    attendance: input.attendance ?? {},
    delivery: input.delivery ?? {},
    seeks_growth: input.seeks_growth === true,
    observations: (input.observations ?? [])
      .map((o) => `${o.metric}|${o.period}|${String(o.value)}|${o.missing ? 1 : 0}`)
      .sort(),
  };
  return fnv1aHex(JSON.stringify(payload));
}

// FNV-1a 32-bit, hex — deterministic across platforms.
// Named fnv1aHex (not fnv1a) so the flat function bundle never collides with
// other shared modules that keep a private fnv1a.
export function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
