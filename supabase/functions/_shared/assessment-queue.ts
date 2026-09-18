// ---------------------------------------------------------------------------
// WorkSense hiring work-queue engine (Batch 5).
// Derives the interviewer/recruiter work queues from canonical rows:
//   upcoming_interviews          — interview sessions still open (invited|in_progress)
//   invitations_awaiting_response— sessions sent to the candidate, never started
//   incomplete_scorecards        — submitted sessions with NO evaluation yet
//   submitted_assessments        — every submitted session (scorecard done or not)
//   awaiting_reviewer_confirmation — model judgments a human must confirm first
//   failed_evaluation_jobs       — retryable failed model evaluations
// Every item is linked to candidate / application / role (requisition) when the
// canonical rows carry that linkage. Nothing is derived from mocks: an item
// exists only when its canonical row exists. Read-only projection.
// ---------------------------------------------------------------------------

export type QueueOwnerRole = "recruiter" | "hr_executive" | "hr_partner";

export type SessionType = "work_sample" | "interview" | "knowledge_assessment";

export interface QueueCandidateRef {
  id: string;
  name: string;
  email: string;
}

export interface QueueRoleRef {
  requisition_id: string;
  title: string;
  application_code: string;
  application_id: string;
}

export interface QueueSessionItem {
  session_id: string;
  session_type: SessionType;
  status: string;
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
  blueprint_title: string;
  candidate: QueueCandidateRef;
  role: QueueRoleRef;
}

export interface AwaitingReviewItem {
  assessment_id: string;
  session_id: string | null;
  session_type: string;
  blueprint_title: string;
  evaluated_at: string;
  model: string;
  review_required: boolean;
  candidate: QueueCandidateRef;
  role: QueueRoleRef;
}

export interface FailedEvaluationJobItem {
  job_id: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
  /** Linked when the evaluation function recorded its session on failure. */
  session: QueueSessionItem | null;
}

export interface AssessmentQueueResult {
  generated_at: string;
  scope: { org_id: string };
  queues: {
    upcoming_interviews: QueueSessionItem[];
    invitations_awaiting_response: QueueSessionItem[];
    incomplete_scorecards: QueueSessionItem[];
    submitted_assessments: QueueSessionItem[];
    awaiting_reviewer_confirmation: AwaitingReviewItem[];
    failed_evaluation_jobs: FailedEvaluationJobItem[];
  };
}

// ---- Canonical input row shapes (subsets of the DB rows) ------------------

export interface QueueSessionRow {
  id: string;
  session_type: string;
  status: string;
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
  application_id: string;
  blueprint_id: string;
}

export interface QueueApplicationRow {
  id: string;
  application_code: string | null;
  requisition_id: string | null;
  candidate_twin_id: string;
  org_id: string;
}

export interface QueueBlueprintRow {
  id: string;
  artifact_spec: { title?: string; kind?: string } | null;
}

export interface QueueTwinRow {
  id: string;
  name: string;
  email: string | null;
}

export interface QueueRequisitionRow {
  id: string;
  title: string;
}

export interface QueueAssessmentRow {
  id: string;
  twin_id: string;
  requisition_id: string | null;
  type: string;
  created_at: string;
  reviewed_at: string | null;
  result: { session_id?: string; blueprint_title?: string; ai?: { model?: string; evaluated_at?: string } | null; review_required?: boolean } | null;
}

export interface QueueJobRow {
  id: string;
  task: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
  output: { session_id?: string } | null;
}

export interface AssessmentQueueInput {
  orgId: string;
  clock: string;
  sessions: QueueSessionRow[];
  applications: QueueApplicationRow[];
  blueprints: QueueBlueprintRow[];
  twins: QueueTwinRow[];
  requisitions: QueueRequisitionRow[];
  assessments: QueueAssessmentRow[];
  jobs: QueueJobRow[];
}

const SESSION_TYPES: SessionType[] = ["work_sample", "interview", "knowledge_assessment"];

function toSessionItem(
  s: QueueSessionRow,
  app: QueueApplicationRow | undefined,
  bpTitle: string,
  twin: QueueTwinRow | undefined,
  reqTitle: string
): QueueSessionItem {
  return {
    session_id: s.id,
    session_type: SESSION_TYPES.includes(s.session_type as SessionType) ? (s.session_type as SessionType) : "work_sample",
    status: s.status,
    expires_at: s.expires_at,
    submitted_at: s.submitted_at ?? null,
    created_at: s.created_at,
    blueprint_title: bpTitle || "Assessment",
    candidate: { id: twin?.id ?? "", name: twin?.name ?? "Unknown candidate", email: twin?.email ?? "" },
    role: {
      requisition_id: app?.requisition_id ?? "",
      title: reqTitle || "—",
      application_code: app?.application_code ?? "—",
      application_id: app?.id ?? "",
    },
  };
}

/** Build the six hiring work queues from canonical rows. Pure + deterministic. */
export function buildAssessmentQueue(input: AssessmentQueueInput): AssessmentQueueResult {
  const apps = new Map(input.applications.map((a) => [a.id, a]));
  const bpTitle = new Map(
    input.blueprints.map((b) => [b.id, (b.artifact_spec?.title ?? "").trim() || "Assessment"])
  );
  const twins = new Map(input.twins.map((t) => [t.id, t]));
  const reqs = new Map(input.requisitions.map((r) => [r.id, r.title]));

  const sessions = input.sessions
    .map((s) => {
      const app = apps.get(s.application_id);
      const twin = app ? twins.get(app.candidate_twin_id) : undefined;
      return toSessionItem(s, app, bpTitle.get(s.blueprint_id) ?? "Assessment", twin, app ? (reqs.get(app.requisition_id ?? "") ?? "—") : "—");
    })
    .filter((s) => s.candidate.id !== "");

  const byId = new Map(sessions.map((s) => [s.session_id, s]));

  const upcoming = sessions
    .filter((s) => s.session_type === "interview" && (s.status === "invited" || s.status === "in_progress"))
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));

  const awaitingResponse = sessions
    .filter((s) => s.status === "invited")
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));

  // A scorecard exists once an evaluation row references the session.
  const evaluatedSessionIds = new Set<string>();
  for (const a of input.assessments) {
    const sid = a.result?.session_id;
    if (sid) evaluatedSessionIds.add(sid);
  }

  const incomplete = sessions
    .filter((s) => s.status === "submitted" && !evaluatedSessionIds.has(s.session_id))
    .sort((a, b) => (a.submitted_at ?? a.created_at).localeCompare(b.submitted_at ?? b.created_at));

  const submitted = sessions
    .filter((s) => s.status === "submitted")
    .sort((a, b) => (b.submitted_at ?? b.created_at).localeCompare(a.submitted_at ?? a.created_at));

  const awaitingReview: AwaitingReviewItem[] = input.assessments
    .filter((a) => !a.reviewed_at)
    .map((a) => {
      const sid = a.result?.session_id ?? null;
      const twin = twins.get(a.twin_id);
      const reqTitle = a.requisition_id ? (reqs.get(a.requisition_id) ?? "—") : "—";
      const session = sid ? byId.get(sid) : undefined;
      return {
        assessment_id: a.id,
        session_id: sid,
        session_type: session?.session_type ?? a.type ?? "interview",
        blueprint_title: a.result?.blueprint_title ?? session?.blueprint_title ?? "Interview",
        evaluated_at: a.result?.ai?.evaluated_at ?? a.created_at,
        model: a.result?.ai?.model ?? "—",
        review_required: a.result?.review_required === true,
        candidate: {
          id: twin?.id ?? "",
          name: twin?.name ?? "Unknown candidate",
          email: twin?.email ?? "",
        },
        role: { requisition_id: a.requisition_id ?? "", title: reqTitle, application_code: session?.role.application_code ?? "—", application_id: session?.role.application_id ?? "" },
      };
    })
    .sort((a, b) => a.evaluated_at.localeCompare(b.evaluated_at));

  const failedJobs: FailedEvaluationJobItem[] = input.jobs
    .filter((j) => j.task === "assessment_evaluation" && j.status === "failed")
    .map((j) => {
      const sid = j.output?.session_id ?? null;
      return {
        job_id: j.id,
        error_code: j.error_code,
        error_message: j.error_message,
        created_at: j.created_at,
        finished_at: j.finished_at,
        session: sid ? (byId.get(sid) ?? null) : null,
      };
    })
    .sort((a, b) => (b.finished_at ?? b.created_at).localeCompare(a.finished_at ?? a.created_at));

  return {
    generated_at: input.clock,
    scope: { org_id: input.orgId },
    queues: {
      upcoming_interviews: upcoming,
      invitations_awaiting_response: awaitingResponse,
      incomplete_scorecards: incomplete,
      submitted_assessments: submitted,
      awaiting_reviewer_confirmation: awaitingReview,
      failed_evaluation_jobs: failedJobs,
    },
  };
}
