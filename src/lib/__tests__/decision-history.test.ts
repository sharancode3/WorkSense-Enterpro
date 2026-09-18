import { describe, expect, it } from "vitest";
import { mergeDecisionHistory, type LegacyAuditEntry } from "../decision-history";
import type { WorkflowEventRow } from "../api";

const baseEvent = (partial: Partial<WorkflowEventRow>): WorkflowEventRow => ({
  id: "evt",
  resource_type: "recommendation",
  resource_id: "rec-1",
  actor_role: "hr_executive",
  resource: null,
  prior_status: null,
  new_status: null,
  reason: null,
  source_version: null,
  request_id: "req-1",
  payload: {},
  created_at: "2026-09-18T09:00:00Z",
  ...partial,
});

describe("mergeDecisionHistory", () => {
  it("keeps the scan-time creation record and drops duplicated legacy transitions", () => {
    const audit: LegacyAuditEntry[] = [
      { actor: "dana@worksense.demo", action: "suggested", note: "Suggested by intelligence scan (RETENTION_INTERVENTION); source hash abc.", timestamp: "2026-09-18T08:00:00Z" },
      { actor: "dana@worksense.demo", action: "approve", rationale: "approving", timestamp: "2026-09-18T09:00:00Z" },
      { actor: "dana@worksense.demo", action: "dispatch", rationale: "dispatch it", timestamp: "2026-09-18T10:00:00Z" },
    ];
    const events = [
      baseEvent({ id: "e1", actor_role: "manager", prior_status: "needs_review", new_status: "approved", reason: "approving", request_id: "r2", created_at: "2026-09-18T09:00:00Z" }),
      baseEvent({ id: "e2", actor_role: "hr_executive", prior_status: "approved", new_status: "execution_pending", reason: "dispatch it", request_id: "r3", created_at: "2026-09-18T10:00:00Z" }),
    ];

    const merged = mergeDecisionHistory(events, audit);

    // Creation + the two canonical transitions only — no duplicated approve/dispatch.
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.kind)).toEqual(["creation", "transition", "transition"]);
    expect(merged[0].actionLabel).toContain("suggested");
    expect(merged[1].actionLabel).toBe("needs_review → approved");
    expect(merged[2].requestId).toBe("r3");
  });

  it("is chronological and includes pre-execution approval/rejection events", () => {
    const audit: LegacyAuditEntry[] = [
      { actor: "dana@worksense.demo", action: "suggested", note: "Suggested", timestamp: "2026-09-18T08:00:00Z" },
    ];
    const events = [
      baseEvent({ id: "e1", prior_status: "suggested", new_status: "needs_review", reason: "submit", request_id: "r1", created_at: "2026-09-18T08:30:00Z" }),
      baseEvent({ id: "e2", prior_status: "needs_review", new_status: "rejected", reason: "no budget", request_id: "r2", created_at: "2026-09-18T09:00:00Z" }),
    ];

    const merged = mergeDecisionHistory(events, audit);
    expect(merged.map((m) => m.actionLabel)).toEqual([
      "suggested",
      "suggested → needs_review",
      "needs_review → rejected",
    ]);
  });

  it("exposes the optional decision message from the event payload", () => {
    const events = [
      baseEvent({ id: "e1", prior_status: "needs_review", new_status: "approved", reason: "good case", request_id: "r1", created_at: "2026-09-18T09:00:00Z", payload: { message: "Coordinate with Elena before dispatch." } }),
    ];
    const merged = mergeDecisionHistory(events, []);
    expect(merged[0].message).toBe("Coordinate with Elena before dispatch.");
  });

  it("carries the accepted outcome evidence on a verified transition", () => {
    const events = [
      baseEvent({
        id: "e1",
        prior_status: "completed",
        new_status: "verified",
        reason: "evidence collected",
        request_id: "r9",
        created_at: "2026-09-18T12:00:00Z",
        payload: { evidence: ["resume-review A1", "manager sign-off"] },
      }),
    ];
    const merged = mergeDecisionHistory(events, []);
    expect(merged[0].evidence).toEqual(["resume-review A1", "manager sign-off"]);
  });

  it("omits an empty or missing evidence payload", () => {
    const merged = mergeDecisionHistory([baseEvent({ id: "e1", payload: { message: "no evidence yet" } })], []);
    expect(merged[0].evidence).toBeUndefined();
  });

  it("returns an empty list when there is nothing to show", () => {
    expect(mergeDecisionHistory([], [])).toEqual([]);
  });

  it("survives events without a prior status (creation-style transitions)", () => {
    const events = [
      baseEvent({ id: "e1", actor_role: "system", prior_status: null, new_status: "suggested", reason: "scan", request_id: "r0", created_at: "2026-09-18T07:00:00Z" }),
    ];
    const merged = mergeDecisionHistory(events, []);
    expect(merged[0].actionLabel).toBe("— → suggested");
    expect(merged[0].actor).toBe("system");
  });
});
