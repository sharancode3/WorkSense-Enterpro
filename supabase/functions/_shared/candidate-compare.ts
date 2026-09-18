// ---------------------------------------------------------------------------
// WorkSense candidate comparison engine (Phase 4).
// Turns requisition criteria + per-candidate persisted fits into comparison
// rows bucketed by match status: scored / unscored / stale. Bucketing rule:
// an unknown score is NEVER ranked as zero — unscored and stale candidates are
// listed below the scored tier and only scored rows are sorted.
// Staleness mirrors skill-match: any requisition audit event after the fit was
// computed invalidates the score (e.g. criteria changed).
// ---------------------------------------------------------------------------

export interface ReqCriterionView {
  skill: string;
  target_proficiency: number;
  requirement: "required" | "preferred";
  weight: number;
  evidence_expectation: string;
}

export type MatchStatus = "scored" | "unscored" | "stale";

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
}

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
  fits: Map<string, { score: number; computed_at: string; classification?: { adjacent?: { skill: string }[]; transferable?: { skill: string }[]; gaps?: { skill: string }[] } }>;
}

export interface CompareResult {
  rows: CompareRow[];
  criteria: ReqCriterionView[];
  scored_count: number;
  unscored_count: number;
  stale_count: number;
}

export function buildCandidateComparison(inputs: CompareInputs): CompareResult {
  const reqAuditNewest = (inputs.req.audit_events ?? [])
    .map((a) => new Date(a.timestamp ?? 0).getTime())
    .filter((t) => Number.isFinite(t))
    .reduce((max, t) => Math.max(max, t), 0);

  const rows: CompareRow[] = inputs.applicants.map((app) => {
    const cand = inputs.candidates.get(app.twin_id);
    const fit = inputs.fits.get(app.twin_id);
    const classification = fit?.classification;
    let status: MatchStatus = "unscored";
    if (fit) {
      const fitAt = new Date(fit.computed_at).getTime();
      status = Number.isFinite(fitAt) && reqAuditNewest > fitAt ? "stale" : "scored";
    }
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
      gaps: classification?.gaps?.map((g) => g.skill) ?? [],
      adjacent: classification?.adjacent?.map((g) => g.skill) ?? [],
      transferable: classification?.transferable?.map((g) => g.skill) ?? [],
    };
  });

  const scored = rows.filter((r) => r.status === "scored").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const unscored = rows.filter((r) => r.status === "unscored");
  const stale = rows.filter((r) => r.status === "stale");

  return {
    rows: [...scored, ...unscored, ...stale],
    criteria: inputs.req.requisition_criteria ?? [],
    scored_count: scored.length,
    unscored_count: unscored.length,
    stale_count: stale.length,
  };
}
