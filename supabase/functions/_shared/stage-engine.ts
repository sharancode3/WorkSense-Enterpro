// ---------------------------------------------------------------------------
// WorkSense application stage engine — the single authorized transition matrix.
// Stage moves are enforced server-side; the client never picks a stage freely.
// A transition is allowed only if (role, current_stage, decision) exists in the
// matrix. Stale-state conflicts (expected_stage / expected_version mismatch)
// surface as a typed 409 so the client can refresh instead of clobbering.
// ---------------------------------------------------------------------------

export const STAGE_ORDER = [
  "screening",
  "technical_interview",
  "final_round",
  "selected",
  "rejected",
] as const;

export type ApplicationStage = (typeof STAGE_ORDER)[number];

export type StageDecision = "move_forward" | "reject" | "select";

/** Roles allowed to drive application stage transitions. */
export const STAGE_ACTOR_ROLES = ["hr_executive", "recruiter"] as const;

type MatrixKey = `${ApplicationStage}|${StageDecision}`;

/** Authorized transitions. Rejection is allowed from any open stage; selection
 *  only from the final round; forward movement only along the pipeline. */
const TRANSITION_MATRIX: Partial<Record<MatrixKey, ApplicationStage>> = {
  "screening|move_forward": "technical_interview",
  "technical_interview|move_forward": "final_round",
  "final_round|select": "selected",
  "screening|reject": "rejected",
  "technical_interview|reject": "rejected",
  "final_round|reject": "rejected",
};

export interface TransitionError {
  ok: false;
  code: "INVALID_DECISION" | "STAGE_TERMINAL" | "TRANSITION_DENIED";
  message: string;
}

/** Resolve the target stage for (current_stage, decision) or a typed error. */
export function resolveTransition(
  current: string,
  decision: string
): { ok: true; newStage: ApplicationStage } | TransitionError {
  const from = current as ApplicationStage;
  if (!STAGE_ORDER.includes(from)) {
    return { ok: false, code: "INVALID_DECISION", message: `Unknown stage "${current}".` };
  }
  if (!["move_forward", "reject", "select"].includes(decision)) {
    return { ok: false, code: "INVALID_DECISION", message: `Unknown decision "${decision}".` };
  }
  if (from === "selected" || from === "rejected") {
    return { ok: false, code: "STAGE_TERMINAL", message: `Stage "${from}" is terminal — no further transitions.` };
  }
  const target = TRANSITION_MATRIX[`${from}|${decision}` as MatrixKey];
  if (!target) {
    return {
      ok: false,
      code: "TRANSITION_DENIED",
      message:
        decision === "move_forward" && from === "final_round"
          ? "Candidates in the final round must be selected or rejected."
          : `Decision "${decision}" is not allowed from stage "${from}".`,
    };
  }
  return { ok: true, newStage: target };
}

export interface StaleState {
  stale: boolean;
  currentStage: string;
  currentVersion: number;
}

/** Optimistic-concurrency check: the caller's expectation must match reality. */
export function checkStale(
  expectedStage: string | undefined,
  expectedVersion: number | undefined,
  actualStage: string,
  actualVersion: number
): StaleState {
  const stale =
    (expectedStage !== undefined && expectedStage !== actualStage) ||
    (expectedVersion !== undefined && expectedVersion !== actualVersion);
  return { stale, currentStage: actualStage, currentVersion: actualVersion };
}

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  screening: "Screening",
  technical_interview: "Technical interview",
  final_round: "Final round",
  selected: "Selected",
  rejected: "Rejected",
};
