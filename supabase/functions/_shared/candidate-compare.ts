// ---------------------------------------------------------------------------
// WorkSense candidate comparison engine (Phase 4 + audit rework).
// Turns requisition criteria + per-candidate persisted fits + assessment /
// interview signals into comparison rows bucketed by match status.
//
// Audit rework: the comparison is now an EVIDENCE FUNNEL with an explicit,
// deterministic ranking formula:
//   rank = renormalized weighted mean over KNOWN components
//     mandatory readiness (0.35) + preferred readiness (0.20)
//     + work-sample rubric (0.20) + structured-interview rubric (0.15)
//     + evidence confidence (0.10)
// Weights renormalize over whatever components are actually measured — an
// unknown component is never scored as zero. Mandatory gates run BEFORE
// ranking: a candidate with an unmet mandatory requirement is "Gated", never
// ranked. "Insufficient evidence" is its own state when no requirement has any
// direct or adjacent contribution. Ties display a deterministic reason.
// Ranking excludes protected/proxy attributes (name, gender-coded terms, age,
// photo, address, college prestige) — surfaced in the fairness panel.
// ---------------------------------------------------------------------------

export interface ReqCriterionView {
  skill: string;
  target_proficiency: number;
  requirement: "required" | "preferred";
  weight: number;
  evidence_expectation: string;
}

export type MatchStatus = "scored" | "unscored" | "stale";

/** Per-candidate non-fit signals used by the ranking (unknown = null, never 0). */
export interface CandidateSignals {
  /** Reviewed work-sample rubric score (0-1), when one exists. */
  work_sample: number | null;
  work_sample_reviewed: boolean;
  /** Reviewed knowledge-assessment score (0-1), when one exists. */
  knowledge: number | null;
  knowledge_reviewed: boolean;
  /** Structured-interview rubric score (0-1) from the latest round. */
  interview_score: number | null;
  interview_status: "none" | "scheduled" | "scored";
  /** Any candidate session has been submitted for this requisition. */
  assessment_submitted: boolean;
}

export interface CompareRow {
  twin_id: string;
  name: string;
  email: string | null;
  stage: string;
  version: number;
  application_code: string;
  applied_at: string;
  status: MatchStatus;
  score: number | null;
  score_at: string | null;
  gaps: string[];
  adjacent: string[];
  transferable: string[];
  // --- Audit rework: evidence funnel + explainable ranking ---
  /** Mandatory gate (true/false) when a fit exists; null when unscored. */
  gate_met: boolean | null;
  mandatory_readiness: number | null;
  preferred_readiness: number | null;
  verified_coverage: { met: number; total: number };
  provisional_coverage: { met: number; total: number };
  evidence_confidence: number | null;
  work_sample: number | null;
  work_sample_reviewed: boolean;
  interview_score: number | null;
  interview_status: "none" | "scheduled" | "scored";
  assessment_submitted: boolean;
  /** Deterministic explainable rank (0-1) or null when not rankable. */
  rank: number | null;
  rank_components: {
    mandatory: number | null;
    preferred: number | null;
    work_sample: number | null;
    interview: number | null;
    confidence: number | null;
  };
  /** "ranked" | "gated" | "insufficient" | "unranked" */
  rank_tier: "ranked" | "gated" | "insufficient" | "unranked";
  /** Deterministic explanation when two ranked rows tie on the composite. */
  tie_reason: string | null;
}

/** Visible weighting policy for the explainable rank (renormalized over known
 *  components). */
export const RANK_WEIGHTS = {
  mandatory: 0.35,
  preferred: 0.2,
  work_sample: 0.2,
  interview: 0.15,
  confidence: 0.1,
} as const;

export interface CompareInputs {
  req: {
    id: string;
    title: string;
    audit_events: { action?: string; timestamp?: string }[];
    requisition_criteria: ReqCriterionView[];
    required_skills: { skill: string; target_proficiency: number }[];
  };
  applicants: {
    twin_id: string;
    stage: string;
    version?: number;
    application_code: string;
    applied_at: string;
  }[];
  candidates: Map<string, { id: string; name: string; email: string | null }>;
  /** twin_id -> persisted fit for THIS requisition (scenario current). */
  fits: Map<
    string,
    {
      score: number;
      computed_at: string;
      profile_match?: number;
      evidence_confidence?: number;
      mandatory_gate?: { met: boolean; unmet_skills: string[] };
      scoring?: {
        requirements: {
          skill: string;
          relationship: string;
          verified_contribution: number | null;
          contribution: number | null;
        }[];
        mandatory?: { readiness: number | null };
        preferred?: { readiness: number | null } | null;
      };
    }
  >;
  /** twin_id -> non-fit signals (assessments / interviews). */
  signals?: Map<string, CandidateSignals>;
}

export interface CompareResult {
  rows: CompareRow[];
  criteria: ReqCriterionView[];
  scored_count: number;
  unscored_count: number;
  stale_count: number;
  /** Visible weighting policy + fairness panel (audit rework). */
  rank_weights: typeof RANK_WEIGHTS;
  fairness: {
    excluded_attributes: string[];
    statement: string;
  };
}

const EMPTY_SIGNAL: CandidateSignals = {
  work_sample: null,
  work_sample_reviewed: false,
  knowledge: null,
  knowledge_reviewed: false,
  interview_score: null,
  interview_status: "none",
  assessment_submitted: false,
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Deterministic explainable rank. Returns {rank, tier, reason} — never zeros
 *  for unknowns, never a rank through an unmet mandatory gate. */
function explainableRank(input: {
  gateMet: boolean | null;
  mandatory: number | null;
  preferred: number | null;
  workSample: number | null;
  interview: number | null;
  confidence: number | null;
}): { rank: number | null; tier: CompareRow["rank_tier"]; components: CompareRow["rank_components"] } {
  const components: CompareRow["rank_components"] = {
    mandatory: input.mandatory,
    preferred: input.preferred,
    work_sample: input.workSample,
    interview: input.interview,
    confidence: input.confidence,
  };
  const known = (Object.entries(components) as [keyof typeof RANK_WEIGHTS, number | null][]).filter(([, v]) => v !== null);
  // No fit signal at all -> unscored territory (handled by status).
  if (input.gateMet === null) return { rank: null, tier: "unranked", components };
  if (input.gateMet === false) return { rank: null, tier: "gated", components };
  if (known.length === 0) return { rank: null, tier: "insufficient", components };
  // Insufficient evidence: a fit exists but nothing maps to any requirement.
  const wSum = known.reduce((s, [k]) => s + RANK_WEIGHTS[k], 0);
  const rank = known.reduce((s, [k, v]) => s + RANK_WEIGHTS[k] * (v as number), 0) / wSum;
  return { rank: round3(rank), tier: "ranked", components };
}

export function buildCandidateComparison(inputs: CompareInputs): CompareResult {
  const reqAuditNewest = (inputs.req.audit_events ?? [])
    .map((a) => new Date(a.timestamp ?? 0).getTime())
    .filter((t) => Number.isFinite(t))
    .reduce((max, t) => Math.max(max, t), 0);

  const rows: CompareRow[] = inputs.applicants.map((app) => {
    const cand = inputs.candidates.get(app.twin_id);
    const fit = inputs.fits.get(app.twin_id);
    const signals = inputs.signals?.get(app.twin_id) ?? EMPTY_SIGNAL;
    const requirements = fit?.scoring?.requirements ?? [];
    let status: MatchStatus = "unscored";
    if (fit) {
      const fitAt = new Date(fit.computed_at).getTime();
      status = Number.isFinite(fitAt) && reqAuditNewest > fitAt ? "stale" : "scored";
    }

    const verifiedMet = requirements.filter((r) => (r.verified_contribution ?? 0) > 0).length;
    const provisionalMet = requirements.filter((r) => (r.contribution ?? 0) > 0).length;
    const total = requirements.length;
    const nothingMaps = total > 0 && verifiedMet === 0 && requirements.every((r) => (r.contribution ?? 0) <= 0);

    const rankResult = explainableRank({
      gateMet: fit ? (fit.mandatory_gate?.met ?? true) : null,
      mandatory: fit?.scoring?.mandatory?.readiness ?? null,
      preferred: fit?.scoring?.preferred?.readiness ?? null,
      workSample: signals.work_sample,
      interview: signals.interview_score,
      confidence: fit ? fit.evidence_confidence ?? null : null,
    });

    return {
      twin_id: app.twin_id,
      name: cand?.name ?? "Unknown candidate",
      email: cand?.email ?? null,
      stage: app.stage,
      version: app.version ?? 1,
      application_code: app.application_code,
      applied_at: app.applied_at,
      status,
      score: fit ? fit.score : null,
      score_at: fit ? fit.computed_at : null,
      gaps: requirements.filter((r) => r.relationship === "none").map((g) => g.skill),
      adjacent: requirements.filter((r) => r.relationship === "adjacent").map((g) => g.skill),
      transferable: requirements.filter((r) => r.relationship === "transferable").map((g) => g.skill),
      gate_met: fit ? (fit.mandatory_gate?.met ?? true) : null,
      mandatory_readiness: fit?.scoring?.mandatory?.readiness ?? null,
      preferred_readiness: fit?.scoring?.preferred?.readiness ?? null,
      verified_coverage: { met: verifiedMet, total },
      provisional_coverage: { met: provisionalMet, total },
      evidence_confidence: fit ? fit.evidence_confidence ?? null : null,
      work_sample: signals.work_sample,
      work_sample_reviewed: signals.work_sample_reviewed,
      interview_score: signals.interview_score,
      interview_status: signals.interview_status,
      assessment_submitted: signals.assessment_submitted,
      rank: rankResult.tier === "gated" || nothingMaps ? null : rankResult.rank,
      rank_components: rankResult.components,
      // Gated takes precedence; otherwise nothing mapping to ANY requirement is
      // "insufficient evidence" — a real state, never a zero rank.
      rank_tier: rankResult.tier === "gated" ? "gated" : nothingMaps ? "insufficient" : rankResult.tier,
      tie_reason: null,
    };
  });

  // Bucket + fair ordering: ranked (composite desc) -> gated/insufficient ->
  // unscored -> stale. Ties on the composite get a deterministic reason.
  const scored = rows.filter((r) => r.status === "scored").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const tieIndex = new Map<string, number>();
  let prevRank: number | null = null;
  let prevKey: string | null = null;
  for (const r of scored) {
    if (r.rank === null) continue;
    if (prevRank !== null && Math.abs(r.rank - prevRank) < 1e-9 && prevKey) {
      const a = rows.find((x) => x.twin_id === prevKey);
      if (a) {
        const compDelta = (Object.keys(RANK_WEIGHTS) as (keyof typeof RANK_WEIGHTS)[])
          .map((k) => {
            const diff = (a.rank_components[k] ?? 0) - (r.rank_components[k] ?? 0);
            if (Math.abs(diff) < 1e-9) return null;
            const label = k === "work_sample" ? "work sample" : k;
            return `${diff > 0 ? a.name : r.name} leads on ${label} (+${Math.abs(diff).toFixed(2)})`;
          })
          .filter(Boolean)
          .slice(0, 2)
          .join(" while ");
        r.tie_reason = `Same composite ${r.rank.toFixed(2)} — ${compDelta || "all components are equal to this precision"}.`;
      }
    }
    prevRank = r.rank;
    prevKey = r.twin_id;
  }
  const unscored = rows.filter((r) => r.status === "unscored");
  const stale = rows.filter((r) => r.status === "stale");

  return {
    rows: [...scored, ...unscored, ...stale],
    criteria: inputs.req.requisition_criteria ?? [],
    scored_count: scored.length,
    unscored_count: unscored.length,
    stale_count: stale.length,
    rank_weights: RANK_WEIGHTS,
    fairness: {
      excluded_attributes: [
        "name",
        "gender / gender-coded terms",
        "age and birth year",
        "photo",
        "address and location history",
        "college and institution prestige",
        "any protected or proxy attributes",
      ],
      statement:
        "Ranking uses only evidence and assessment signals: mandatory readiness, preferred readiness, work-sample and interview rubrics, and evidence confidence. Protected or proxy attributes are never read into the composite.",
    },
  };
}
