// Batch 9: pure staleness predicates for the staffing planner.
//
// A plan/proposal is "fresh" only while the inputs it was computed from are
// unchanged. Two independent staleness signals exist:
//   1. Dirty inputs — the saved plan is bound to an exact input fingerprint;
//      changing any input (without recalculating) makes it outdated and blocks
//      explain/propose until recalculated.
//   2. Stale proposal — a submitted proposal binds the option + scenario
//      version it was computed at; once the plan runs on a newer assumptions
//      version, the proposal no longer matches what a fresh computation would
//      show, so it must be flagged (and a fresh proposal created) before
//      sending it to human review.
//
// Both are deliberately pure and dependency-free so they are trivially
// unit-testable and cannot drag UI state into the verification of a rule.

/**
 * True when a saved plan exists but the current inputs no longer match the
 * fingerprint the plan was computed at.
 */
export function isInputFingerprintOutdated(
  planPresent: boolean,
  inputFingerprint: string | null,
  currentFingerprint: string,
): boolean {
  return planPresent && inputFingerprint !== null && inputFingerprint !== currentFingerprint;
}

/**
 * True when a submitted proposal was bound to a scenario/assumptions version
 * that differs from the version the current plan runs on.
 */
export function isProposalStale(
  proposalScenarioVersion: string,
  currentScenarioVersion: string,
): boolean {
  return proposalScenarioVersion !== currentScenarioVersion;
}
