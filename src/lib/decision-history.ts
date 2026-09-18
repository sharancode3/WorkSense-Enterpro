// Batch C (C3): a single, deduplicated decision history for a recommendation.
//
// The canonical audit trail lives in workflow_events (every lifecycle
// transition, written by the transactional RPC). The recommendations table
// also carries a legacy `audit_events` jsonb array — its only non-redundant
// entry is the scan-time creation record ("suggested by intelligence scan"),
// because that predates the first workflow event. This helper merges the two
// into one chronological list, dropping legacy entries that duplicate a
// canonical transition (submit/approve/reject/dispatch/start/complete/fail/
// cancel/mark_stale/re_review/verify).

import type { WorkflowEventRow } from "./api";

/** Transition actions recorded canonically in workflow_events. */
const CANONICAL_ACTIONS = new Set([
  "submit",
  "approve",
  "reject",
  "dispatch",
  "start",
  "complete",
  "verify",
  "fail",
  "cancel",
  "mark_stale",
  "re_review",
]);

export interface LegacyAuditEntry {
  actor: string;
  action: string;
  rationale?: string;
  before?: string;
  after?: string;
  note?: string;
  timestamp: string;
}

export interface DecisionHistoryItem {
  /** Stable key for React. */
  key: string;
  /** "creation" = scan-time suggestion (legacy), "transition" = workflow event. */
  kind: "creation" | "transition";
  /** Who acted — legacy actor email or canonical actor role. */
  actor: string;
  /** Short human label for the event. */
  actionLabel: string;
  /** The reason / note recorded with the action. */
  detail: string;
  /** Optional human note attached to the decision (C2). */
  message?: string;
  /** Accepted outcome evidence on a verified transition (A4). */
  evidence?: string[];
  /** Canonical request id, when this is a workflow transition. */
  requestId?: string;
  timestamp: string;
}

export function mergeDecisionHistory(
  events: WorkflowEventRow[],
  auditEvents: LegacyAuditEntry[]
): DecisionHistoryItem[] {
  const items: DecisionHistoryItem[] = [];

  // Creation record: only the scan-time suggestion (and any legacy entry that
  // does not duplicate a canonical transition) survives the merge.
  for (const a of auditEvents ?? []) {
    if (CANONICAL_ACTIONS.has(a.action)) continue;
    items.push({
      key: `legacy-${a.timestamp}-${a.action}`,
      kind: "creation",
      actor: a.actor,
      actionLabel: a.action.replace(/_/g, " "),
      detail: a.note ?? a.rationale ?? "",
      timestamp: a.timestamp,
    });
  }

  for (const e of events ?? []) {
    const message =
      typeof e.payload?.message === "string" && e.payload.message.trim().length > 0 ? e.payload.message : undefined;
    const evidence = Array.isArray(e.payload?.evidence)
      ? (e.payload.evidence as unknown[]).map((x) => String(x)).filter((x) => x.length > 0)
      : undefined;
    items.push({
      key: e.id,
      kind: "transition",
      actor: e.actor_role ?? "system",
      actionLabel: `${e.prior_status ?? "—"} → ${e.new_status ?? "—"}`,
      detail: e.reason ?? "",
      message,
      evidence: evidence && evidence.length > 0 ? evidence : undefined,
      requestId: e.request_id,
      timestamp: e.created_at,
    });
  }

  return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
