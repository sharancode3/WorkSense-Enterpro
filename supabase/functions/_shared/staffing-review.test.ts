import { describe, expect, it } from "vitest";
import {
  buildFollowUpTaskRow,
  isProposalDecision,
  planProposalDecision,
  PROPOSAL_FOLLOW_UP_TASK,
} from "./staffing-review";

const NOW = "2026-09-18T12:00:00.000Z";

const proposal = (overrides: { status?: string; option_label?: string | null; option_snapshot?: unknown } = {}) => ({
  status: "open",
  option_label: "Internal move — Diego Mensah",
  option_snapshot: { subject: "Diego Mensah" },
  ...overrides,
});

describe("planProposalDecision (staffing proposal human review)", () => {
  it("approves and persists reviewer identity + note + timestamp", () => {
    const plan = planProposalDecision({
      proposal: proposal(),
      decision: "approved",
      reviewNote: "Coverage is verified; approve the move.",
      reviewerId: "twin-hr",
      now: NOW,
    });
    expect(plan.update).toEqual({
      status: "approved",
      review_note: "Coverage is verified; approve the move.",
      reviewed_by: "twin-hr",
      reviewed_at: NOW,
    });
  });

  it("uses a default note when none is supplied", () => {
    const approved = planProposalDecision({ proposal: proposal(), decision: "approved", reviewNote: null, reviewerId: "hr", now: NOW });
    const declined = planProposalDecision({ proposal: proposal(), decision: "declined", reviewNote: null, reviewerId: "hr", now: NOW });
    expect(approved.update.review_note).toContain("Approved");
    expect(declined.update.review_note).toContain("Declined");
  });

  it("declines without dispatching a follow-up task even when a subject exists", () => {
    const plan = planProposalDecision({ proposal: proposal(), decision: "declined", reviewNote: null, reviewerId: "hr", now: NOW });
    expect(plan.update.status).toBe("declined");
    expect(plan.subjectName).toBeNull();
  });

  it("approval only dispatches a follow-up when the option names a subject", () => {
    const withSubject = planProposalDecision({ proposal: proposal(), decision: "approved", reviewNote: null, reviewerId: "hr", now: NOW });
    expect(withSubject.subjectName).toBe("Diego Mensah");

    const externalHire = planProposalDecision({
      proposal: proposal({ option_label: "Hire externally", option_snapshot: {} }),
      decision: "approved",
      reviewNote: null,
      reviewerId: "hr",
      now: NOW,
    });
    expect(externalHire.subjectName).toBeNull();
  });

  it("ignores whitespace-only subject names", () => {
    const plan = planProposalDecision({
      proposal: proposal({ option_snapshot: { subject: "   " } }),
      decision: "approved",
      reviewNote: null,
      reviewerId: "hr",
      now: NOW,
    });
    expect(plan.subjectName).toBeNull();
  });
});

describe("isProposalDecision", () => {
  it("accepts approved and declined, rejects everything else", () => {
    expect(isProposalDecision("approved")).toBe(true);
    expect(isProposalDecision("declined")).toBe(true);
    expect(isProposalDecision("open")).toBe(false);
    expect(isProposalDecision(undefined)).toBe(false);
    expect(isProposalDecision(null)).toBe(false);
  });
});

describe("buildFollowUpTaskRow (owned task dispatch)", () => {
  it("builds an employee-owned open task with an idempotency key", () => {
    const row = buildFollowUpTaskRow({
      orgId: "org-1",
      ownerTwinId: "twin-diego",
      optionLabel: "Internal move — Diego Mensah",
      proposalId: "prop-1",
      now: NOW,
    });
    expect(row).toMatchObject({
      org_id: "org-1",
      owner_twin_id: "twin-diego",
      owner_role: "employee",
      task_code: "staffing_transition",
      status: "open",
      created_by_request_id: "staffing-proposal:prop-1",
    });
    expect(row.title).toBe(PROPOSAL_FOLLOW_UP_TASK.title("Internal move — Diego Mensah"));
    expect(row.due_at).toBe(new Date(new Date(NOW).getTime() + 14 * 86400000).toISOString());
    expect(row.required_evidence).toEqual(["work_reference"]);
  });
});
