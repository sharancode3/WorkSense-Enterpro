// Batch 10: pure decision rules for the staffing-proposal human-review loop.
//
// A proposal binds the selected option + the scenario version it was computed
// at. A human reviewer either approves it (which may dispatch an owned
// follow-up task when the option resolves to an existing employee) or declines
// it — either way the decision is a durable record (status, reviewer, note,
// timestamp) that the submitter sees. This module only decides WHAT to persist;
// all DB lookups/writes happen in the calling function, so the rules are
// trivially unit-testable and cannot accidentally grant access.

export const PROPOSAL_DECISIONS = ["approved", "declined"] as const;
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number];

export const PROPOSAL_REVIEWER_ROLES = ["hr_executive", "hr_partner"] as const;
export type ProposalReviewerRole = (typeof PROPOSAL_REVIEWER_ROLES)[number];

/** Follow-up task dispatched when an approved proposal resolves to an employee. */
export const PROPOSAL_FOLLOW_UP_TASK = {
  task_code: "staffing_transition",
  title: (optionLabel: string) => `Execute approved staffing decision — ${optionLabel}`,
  due_in_days: 14,
  required_evidence: ["work_reference"],
  outcome_measure: { metric: "transition_completed", target: true },
} as const;

export function isProposalDecision(value: unknown): value is ProposalDecision {
  return typeof value === "string" && (PROPOSAL_DECISIONS as readonly string[]).includes(value);
}

export interface DecisionInput {
  proposal: { status: string; option_label: string | null; option_snapshot: unknown };
  decision: ProposalDecision;
  reviewNote: string | null;
  reviewerId: string;
  now: string;
}

export interface DecisionPlan {
  /** The persisted update for the proposal row (version-guarded by the caller). */
  update: { status: ProposalDecision; review_note: string; reviewed_by: string; reviewed_at: string };
  /** Option subject name when approval should dispatch an owned follow-up task. */
  subjectName: string | null;
}

export function planProposalDecision(input: DecisionInput): DecisionPlan {
  const snapshot = (input.proposal.option_snapshot ?? {}) as { subject?: unknown };
  const subject = typeof snapshot.subject === "string" && snapshot.subject.trim() ? snapshot.subject.trim() : null;
  return {
    update: {
      status: input.decision,
      review_note:
        input.reviewNote ??
        (input.decision === "approved"
          ? "Approved — proceed with the staffing decision."
          : "Declined — not approved at this time."),
      reviewed_by: input.reviewerId,
      reviewed_at: input.now,
    },
    subjectName: input.decision === "approved" ? subject : null,
  };
}

export interface FollowUpTaskInput {
  orgId: string;
  ownerTwinId: string;
  optionLabel: string;
  proposalId: string;
  now: string;
}

/**
 * Row for an employee-owned action task that surfaces in the subject's My work
 * feed. `created_by_request_id` is the idempotency key (staffing-proposal:<id>)
 * so duplicate review calls can never double-dispatch.
 */
export function buildFollowUpTaskRow(input: FollowUpTaskInput) {
  return {
    org_id: input.orgId,
    owner_twin_id: input.ownerTwinId,
    owner_role: "employee",
    task_code: PROPOSAL_FOLLOW_UP_TASK.task_code,
    title: PROPOSAL_FOLLOW_UP_TASK.title(input.optionLabel),
    status: "open",
    due_at: new Date(new Date(input.now).getTime() + PROPOSAL_FOLLOW_UP_TASK.due_in_days * 86400000).toISOString(),
    instructions: `Approved staffing decision: ${input.optionLabel}. Coordinate the transition with the responsible HR partner, complete the required steps, and attach evidence when done.`,
    required_evidence: [...PROPOSAL_FOLLOW_UP_TASK.required_evidence],
    outcome_measure: { ...PROPOSAL_FOLLOW_UP_TASK.outcome_measure },
    outcome: {},
    created_by_request_id: `staffing-proposal:${input.proposalId}`,
  };
}
