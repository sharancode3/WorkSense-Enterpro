// ---------------------------------------------------------------------------
// WorkSense fit store (Batch 6 — cross-module handoffs).
// One canonical fit source: the `skill_fits` table (atomic upsert per
// twin + target + scenario), which candidate-compare and the Fit card read.
// `computed_fits` on digital_twins is only a legacy mirror. resume-review and
// assessment-review recompute fits when evidence/claims change and MUST write
// the canonical row — otherwise the hiring comparison shows a stale score.
// ---------------------------------------------------------------------------

export interface FitLike {
  target_type?: string;
  target_id?: string;
  scenario?: string;
  [k: string]: unknown;
}

/** Replace any stored fit for the same target + scenario; never lose others. */
export function mergeLegacyFits(fits: FitLike[], incoming: FitLike): FitLike[] {
  const others = (fits ?? []).filter(
    (f) => !(f.target_id === incoming.target_id && f.scenario === incoming.scenario)
  );
  return [...others, incoming];
}

/** Append one labeled audit event (never clobber history). */
export function appendAuditEvent(events: unknown[], event: unknown): unknown[] {
  return [...(events ?? []), event];
}

/**
 * Persist a recomputed fit to the canonical skill_fits row and mirror it into
 * the twin's legacy computed_fits array. Idempotent per (twin, target,
 * scenario): a concurrent recompute for a different target is never lost.
 */
export async function upsertSkillFit(
  supabase: {
    from: (table: string) => {
      upsert: (rows: unknown, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
      select: (cols: string) => {
        eq: (col: string, value: string) => Promise<{ data: { computed_fits?: unknown[]; audit_events?: unknown[] } | null }>;
      };
      update: (patch: Record<string, unknown>) => {
        eq: (col: string, value: string) => Promise<unknown>;
      };
    };
  },
  params: {
    orgId: string;
    twinId: string;
    targetId: string;
    scenario: "current" | "future";
    fit: unknown;
    computedAt: string;
    actor?: string;
    action?: string;
    note?: string;
  }
) {
  const { error } = await supabase
    .from("skill_fits")
    .upsert(
      {
        org_id: params.orgId,
        twin_id: params.twinId,
        target_type: "requisition",
        target_id: params.targetId,
        scenario: params.scenario,
        fit: params.fit,
        computed_at: params.computedAt,
      },
      { onConflict: "twin_id,target_type,target_id,scenario" }
    );
  if (error) throw error;

  // Best-effort legacy mirror (source of truth stays skill_fits).
  const { data: twin } = await supabase
    .from("digital_twins")
    .select("computed_fits, audit_events")
    .eq("id", params.twinId);
  if (twin) {
    const fitLike = params.fit as FitLike;
    const fits = mergeLegacyFits((twin.computed_fits ?? []) as FitLike[], fitLike);
    const patch: Record<string, unknown> = { computed_fits: fits };
    if (params.note) {
      patch.audit_events = appendAuditEvent(twin.audit_events ?? [], {
        actor: params.actor ?? "system",
        action: params.action ?? "fit_refreshed",
        note: params.note,
        timestamp: params.computedAt,
      });
    }
    await supabase.from("digital_twins").update(patch).eq("id", params.twinId);
  }
}
