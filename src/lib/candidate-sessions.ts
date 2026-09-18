// Batch 5 (5.1/5.3): candidate workspace session discoverability.
// Loads a candidate's real candidate_sessions rows for one application and
// NEVER collapses a read failure into an empty list. Supabase errors are
// thrown with a `code` so callers can distinguish forbidden / unavailable /
// error states and show an explicit retry instead of a false "no assessments".

import { supabase } from "@/integrations/supabase/client";

export type SessionType = "work_sample" | "interview" | "knowledge_assessment";

export interface CandidateSessionSummary {
  id: string;
  session_type: SessionType;
  status: string;
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
  blueprint_title: string;
}

export const SESSION_TYPE_LABEL: Record<string, string> = {
  work_sample: "Work sample",
  interview: "Interview",
  knowledge_assessment: "Knowledge assessment",
};

export const SESSION_STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  in_progress: "In progress",
  submitted: "Submitted",
  expired: "Expired",
  cancelled: "Cancelled",
};

export class SessionListError extends Error {
  constructor(
    public code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "SessionListError";
  }
}

/**
 * Load session summaries for an application. Throws `SessionListError` (with
 * the Supabase error code) when the read fails — callers must render that as
 * an error, never as an empty list.
 */
export async function loadCandidateSessions(applicationId: string): Promise<CandidateSessionSummary[]> {
  const { data: sess, error } = await supabase
    .from("candidate_sessions")
    .select("id, session_type, status, expires_at, submitted_at, created_at, blueprint_id")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) {
    // RLS denial surfaces as 42501 — classify it as forbidden so the UI shows
    // an access-denied state instead of a generic error or an empty list.
    throw new SessionListError(error.code === "42501" ? "FORBIDDEN" : error.code, error.message);
  }

  const blueprintIds = [...new Set((sess ?? []).map((s) => s.blueprint_id as string))];
  let titleById = new Map<string, string>();
  if (blueprintIds.length > 0) {
    const { data: bps, error: bpErr } = await supabase
      .from("assessment_blueprints")
      .select("id, artifact_spec")
      .in("id", blueprintIds);
    if (bpErr) throw new SessionListError(bpErr.code, bpErr.message);
    titleById = new Map(
      (bps ?? []).map((b) => [b.id, (b.artifact_spec as { title?: string } | null)?.title ?? b.id])
    );
  }

  return (sess ?? []).map((s) => ({
    id: s.id,
    session_type: s.session_type as SessionType,
    status: s.status,
    expires_at: s.expires_at,
    submitted_at: s.submitted_at,
    created_at: s.created_at,
    blueprint_title: titleById.get(s.blueprint_id) ?? "Assessment",
  }));
}
