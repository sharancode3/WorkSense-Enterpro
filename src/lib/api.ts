import { supabase } from "@/integrations/supabase/client";
import type { Role } from "./rbac";

export interface Twin {
  id: string;
  org_id: string | null;
  auth_user_id: string | null;
  role: Role;
  status: string;
  name: string;
  email: string;
  department: string | null;
  job_title: string | null;
  manager_id: string | null;
  tenure_months: number;
  verified_skills: SkillClaim[];
  interview_rubrics: unknown[];
  performance_history: unknown[];
  signals: unknown[];
  computed_fits: unknown[];
  audit_events: unknown[];
}

export interface SkillClaim {
  name: string;
  proficiency: number;
  evidence_source: string;
  verification_rigor: string;
}

export interface MeResult {
  user: { id: string; email?: string };
  twin: Twin;
}

export interface CandidateStatusResult {
  ok: true;
  application_status: string;
  requisition: { title: string; department: string };
  applicant: { name: string; verified_skills: { name: string; proficiency: number }[] };
  sessions?: {
    token: string;
    session_type: string;
    status: string;
    expires_at: string;
    submitted_at: string | null;
    title: string;
  }[];
}

export async function fetchMe(): Promise<MeResult> {
  const { data, error } = await supabase.functions.invoke<MeResult>("me");
  if (error) throw new Error(error.message || "me: invocation failed");
  if (!data?.ok) throw new Error("me: no twin for this account");
  return data;
}

export async function resetDemo(): Promise<{ ok: true }> {
  const { data, error } = await supabase.functions.invoke<{ ok: true }>("reset-demo", {
    body: {},
  });
  if (error) throw new Error(error.message || "reset-demo: invocation failed");
  if (!data?.ok) throw new Error("reset-demo: reset failed");
  return data;
}

export class ApiError extends Error {
  constructor(message: string, public code?: string, public context?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchCandidateStatus(
  applicationCode: string,
  include?: string[]
): Promise<CandidateStatusResult> {
  const { data, error } = await supabase.functions.invoke<CandidateStatusResult>("candidate-status", {
    body: { application_code: applicationCode, include },
  });
  if (error) {
    const ctx = (error as { context?: { error?: string; message?: string } }).context;
    throw new ApiError(ctx?.message ?? error.message ?? "Request failed", ctx?.error);
  }
  if (!data?.ok) throw new ApiError("candidate-status: unexpected response");
  return data;
}

export interface ExtractResumeResult {
  ok: true;
  job_id: string;
  status: "succeeded" | "failed" | "queued" | "running";
  full_name: string;
  years_experience: number;
  extracted_skills: { name: string; proficiency: number; evidence_source: string; verification_rigor: string; evidence?: string; years: number }[];
  verified_projects: { project_name: string; role: string; tech_stack: string[]; impact_metric: string }[];
  fit: FitRecordShape | null;
}

export interface RubricCompetency {
  competency: string;
  question: string;
  follow_up_probes: string[];
  rubric: { tier_1: string; tier_2: string; tier_3: string; tier_4: string; tier_5: string };
}

export interface InterviewKit {
  type: string;
  req_id: string;
  req_title: string;
  candidate_name: string;
  score: number;
  focus_items: string[];
  biased_probe: RubricCompetency | null;
  competencies: RubricCompetency[];
  created_at: string;
}

export interface InterviewEvaluation {
  type: string;
  req_id: string;
  req_title: string;
  candidate_name: string;
  evaluations: { competency: string; tier: string; score: number; evidence: string; strengths: string[]; concerns: string[] }[];
  overall_recommendation: string;
  summary: string;
  evaluated_at: string;
  evaluator: string;
}

export interface FitRecordShape {
  score: number;
  computed_at: string;
}

async function invoke<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const ctx = (error as { context?: Record<string, unknown> }).context;
    throw new ApiError(error.message || `${name}: failed`, (ctx?.error as string) ?? undefined, ctx);
  }
  return data as T;
}

export const extractResume = (twinId: string, resumeText: string, reqId?: string) =>
  invoke<ExtractResumeResult>("extract-resume", { twin_id: twinId, resume_text: resumeText, req_id: reqId });

export const generateRubrics = (reqId: string, competencies?: string[]) =>
  invoke<{ ok: true; rubrics: RubricCompetency[] }>("rubric", { req_id: reqId, competencies });

export const generateInterviewKit = (twinId: string, reqId: string) =>
  invoke<{ ok: true; kit: InterviewKit }>("interview-kit", { twin_id: twinId, req_id: reqId });

export const evaluateInterview = (twinId: string, reqId: string, notes: string) =>
  invoke<{ ok: true; evaluation: InterviewEvaluation }>("evaluate-interview", { twin_id: twinId, req_id: reqId, notes });

export const recruiterDecision = (twinId: string, reqId: string, decision: "move_forward" | "reject" | "select", note?: string) =>
  invoke<{ ok: true; decision: string; applicant?: { twin_id: string; stage: string }; converted?: unknown; note?: string }>(
    "recruiter-decision",
    { twin_id: twinId, req_id: reqId, decision, note }
  );

export const requisitionCreate = (payload: {
  title: string;
  department: string;
  seniority_level: number;
  required_skills: { skill: string; target_proficiency: number }[];
  future_skills: { skill: string; target_proficiency: number }[];
}) => invoke<{ ok: true; requisition: unknown }>("requisition", { action: "create", ...payload });

// ---- Onboarding ----

export interface ScheduledTask {
  id: string;
  title: string;
  depends_on: string[];
  skill?: string;
  target_proficiency?: number;
  non_waivable?: boolean;
  duration_days: number;
  waived: boolean;
  status: "waived" | "pending" | "done" | "blocked";
  start_date: string | null;
  end_date: string | null;
  topological_level: number;
  blocked?: { note: string; reported_by: string; at: string } | null;
}

export interface OnboardingPlan {
  start_date: string;
  approvals: { role: string; approved: boolean; by: string; at: string }[];
  fit_current: number;
  fit_future: number;
  generated_at: string;
}

export interface JourneyRow {
  id: string;
  twin_id: string;
  status: string;
  plan: OnboardingPlan;
  tasks: ScheduledTask[];
}

export const onboardingPlan = (twinId: string, startDate?: string) =>
  invoke<{ ok: true; journey: JourneyRow }>("onboarding-plan", { twin_id: twinId, start_date: startDate });

export const onboardingApprove = (journeyId: string) =>
  invoke<{ ok: true; status: string; manager_approved: boolean; hr_approved: boolean; approvals: unknown[] }>(
    "onboarding-approve",
    { journey_id: journeyId }
  );

export const onboardingTask = (
  journeyId: string,
  taskId: string,
  action: "complete" | "block" | "resolve",
  note?: string
) =>
  invoke<{ ok: true; action: string; task_id: string; tasks: ScheduledTask[] }>(
    "onboarding-task",
    { journey_id: journeyId, task_id: taskId, action, note }
  );

// ---- Policy Studio ----

export interface PolicyCitation {
  claim?: string;
  doc_code: string;
  version: number | null;
  section: string;
  heading?: string;
  exact_quote: string;
  doc_title?: string;
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface PolicyRetrievedChunk {
  doc_code: string;
  doc_title: string;
  version?: number;
  section_code: string;
  heading: string;
  text: string;
  score: number;
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface PolicyComputedFacts {
  topic: string;
  employee?: { name: string | null; work_location: string | null; worker_type: string | null };
  balance?: { accrued_days: number; taken_days: number; unused_days: number; carryover_days: number; carryover_cap_days: number; as_of: string; join_date: string };
  months_in_leave_year?: number;
  request_span?: { calendar_days: number; holiday_days: number; leave_days_consumed: number } | null;
}

export type PolicyAnswerStatus = "grounded" | "partially_supported" | "insufficient_evidence" | "clarification_needed";

export interface PolicyAnswer {
  status: PolicyAnswerStatus;
  abstained: boolean;
  best_score: number;
  threshold: number;
  answer: string;
  citations: PolicyCitation[];
  retrieval: PolicyRetrievedChunk[];
  note?: string;
  clarification?: { fields: string[]; reason: string; doc_code: string; doc_title: string };
  computed?: PolicyComputedFacts;
  employee_context?: { name?: string; work_location?: string; worker_type?: string };
  expired_policy?: { doc_code: string; title: string; effective_to: string | null; score: number };
  excluded_policy?: { doc_code: string; title: string; context: Record<string, unknown> };
}

export interface PolicyContextResult {
  ok: true;
  employees: { id: string; name: string; work_location: string | null; worker_type: string | null }[];
  policies: { id: string; doc_code: string; version: number; title: string; category: string; effective_from: string | null; effective_to: string | null; applicable_locations: string[]; applicable_worker_types: string[] }[];
}

export const policyAsk = (question: string, employeeId?: string, context?: { location?: string; worker_type?: string; taken_days?: number; request_from?: string; request_to?: string }) =>
  invoke<PolicyAnswer>("policy-qa", { question, employee_id: employeeId, context });

export const policyContext = () => invoke<PolicyContextResult>("policy-qa", { action: "context" });

export const escalatePolicy = (question: string, context?: Record<string, unknown>, sources?: unknown[], reason?: string) =>
  invoke<{ ok: true; escalation_id: string; status: string; created_at: string; owner: string; message: string }>(
    "escalate",
    { question, context, sources, reason }
  );

// ---- Recommendation & Action Hub ----

export interface RecommendationRow {
  id: string;
  twin_id: string | null;
  category: string;
  urgency: string;
  status: "needs_review" | "approved" | "rejected" | "dispatched" | "completed";
  evidence_ledger: { source: string; fact: string }[];
  proposed_action: {
    title: string;
    description: string;
    steps: { order: number; action: string }[];
    executive_summary?: string;
    recommended_action?: string;
  };
  executive_summary: string;
  required_signoff_role: string | null;
  reviewer_rationale: { last?: string; by?: string; at?: string } | Record<string, never>;
  audit_events: { actor: string; action: string; rationale?: string; before?: string; after?: string; note?: string; timestamp: string }[];
  created_at: string;
}

export const recommendationScan = () =>
  invoke<{ ok: true; scanned_candidates: number; created: number; created_ids: string[] }>("recommendation-scan", {});

export const recommendationDecision = (recId: string, decision: string, rationale: string) =>
  invoke<{ ok: true; status: string; effect?: string | null; rationale: string }>(
    "recommendation-decision",
    { rec_id: recId, decision, rationale }
  );

// ---- Executive Decision Dashboard ----

export interface DashboardData {
  ok: true;
  scope: "org" | "team";
  threshold: number;
  cards: {
    headcount: number;
    open_requisitions: number;
    active_candidates: number;
    journeys_in_progress: number;
    journeys_on_track: number;
    journeys_blocked: number;
    at_risk_employees: number;
    pending_recommendations: number;
  };
  heatmap: { skill: string; target_proficiency: number; req_id: string; req_title: string; gap_count: number; total: number }[];
  recommendations: { id: string; category: string; urgency: string; title: string; executive_summary: string }[];
}

export const fetchDashboard = () => invoke<DashboardData>("dashboard", {});

// ---- Model gateway observability ----

export interface ModelJobView {
  id: string;
  task: string;
  status: "queued" | "running" | "succeeded" | "failed";
  model: string;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  output: unknown;
}

export interface HealthView {
  ok: true;
  app_backend: string;
  gateway: "reachable" | "unreachable";
  model_ready: boolean;
  gateway_authenticated: boolean;
  model: string;
}

export const fetchModelJob = (jobId: string) => invoke<{ ok: true; job: ModelJobView }>("model-job", { job_id: jobId });

export const fetchHealth = () => invoke<HealthView>("health", {});

// ---- Phase 4: file-based resume ingestion & evidence review ----

export interface ResumeSkillClaim {
  skill: string;
  years?: number;
  proficiency_tier: string;
  quote: string;
  association: "explicit" | "inferred" | "unsupported";
}
export interface ResumeRole {
  title: string;
  company: string;
  start?: string;
  end?: string;
  years_claimed?: number;
  quote: string;
}
export interface ResumeProject {
  name: string;
  role: string;
  tech_stack: string[];
  impact_metric: string;
  quote: string;
}
export interface ResumeReviewPayload {
  full_name: string;
  contact?: { email?: string; phone?: string; location?: string; linkedin?: string };
  roles?: ResumeRole[];
  education?: { institution: string; degree: string; year: string; quote: string }[];
  certifications?: { name: string; issuer: string; year: string; quote: string }[];
  projects?: ResumeProject[];
  skill_claims?: ResumeSkillClaim[];
  ambiguities?: string[];
  conflicts?: string[];
  computed?: {
    total_years_deduped?: number;
    roles_merged?: number;
    overlap_warnings?: string[];
    claims_unsupported?: number;
  };
}
export interface ResumeImportResult {
  ok: true;
  duplicate?: boolean;
  document_id: string;
  version_id?: string;
  version?: number;
  status: string;
  low_text: boolean;
  ocr_available: boolean;
  page_count: number | null;
  file_name: string;
  extracted_text: string;
  review?: ResumeReviewPayload;
  message?: string;
  job_id?: string;
  warnings?: { conflicts: string[]; overlaps: string[] };
  versions?: { id: string; version: number; review_state: string; created_at: string }[];
}
export interface ResumeReviewSaveResult {
  ok: true;
  document_id: string;
  version: number;
  claims_saved: number;
  evidence_saved: number;
  conflicts_resolved: string[];
  fit: FitRecordShape | null;
}
export interface ResumeDownloadResult {
  ok: true;
  url: string;
  file_name: string;
  content_type: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export const resumeImport = (twinId: string, reqId: string | undefined, file: File) =>
  fileToBase64(file).then((file_base64) =>
    invoke<ResumeImportResult>("resume-import", {
      twin_id: twinId,
      req_id: reqId,
      file_name: file.name,
      file_base64,
    })
  );

export const resumeReview = (documentId: string, twinId: string, reqId: string | undefined, review: ResumeReviewPayload) =>
  invoke<ResumeReviewSaveResult>("resume-review", { document_id: documentId, twin_id: twinId, req_id: reqId, review });

export const resumeDownload = (documentId: string) => invoke<ResumeDownloadResult>("resume-download", { document_id: documentId });

export interface DemoResumeFixture {
  file: string;
  kind: string;
  label: string;
  bytes: number;
}

export async function listDemoResumes(): Promise<DemoResumeFixture[]> {
  const res = await fetch(`${import.meta.env.BASE_URL ?? "/"}resume-fixtures/index.json`);
  if (!res.ok) throw new Error("Demo resumes unavailable.");
  return (await res.json()) as DemoResumeFixture[];
}

// ---- Phase 6: applications lifecycle, assessments, candidate sessions ----

export interface StageEventRow {
  id: string;
  prior_stage: string;
  new_stage: string;
  reason: string | null;
  at: string;
  version: number;
  actor_twin_id: string;
}

export interface ApplicationRow {
  id: string;
  org_id: string;
  candidate_twin_id: string;
  requisition_id: string;
  stage: string;
  application_code: string;
  applied_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ApplicationStageResult {
  ok: true;
  application: { id: string; stage: string; version: number };
  decision: string;
  transition: { prior_stage: string; new_stage: string };
  reason: string;
  version: number;
  conversion?: unknown;
  fits?: { current: number | null; future: number | null };
  history: StageEventRow[];
}

export const applicationStage = (
  applicationId: string,
  decision: "move_forward" | "reject" | "select",
  expectedStage: string,
  expectedVersion: number,
  reason?: string
) =>
  invoke<ApplicationStageResult>("application-stage", {
    application_id: applicationId,
    decision,
    expected_stage: expectedStage,
    expected_version: expectedVersion,
    reason,
  });

export interface SessionQuestion {
  key: string;
  prompt: string;
  hint?: string;
  max_chars: number;
}

export interface AssessmentSessionView {
  id: string;
  session_type: "work_sample" | "interview";
  status: string;
  expires_at: string;
  time_policy: string;
  accommodation: Record<string, unknown>;
  submitted_at: string | null;
  submission_hash: string | null;
  invitation_token?: string;
  answers: Record<string, string>;
  drafts: Record<string, string>;
  follow_ups: { key: string; prompt: string; source?: string }[];
  blueprint: {
    title: string;
    instructions: string;
    questions: SessionQuestion[];
    test_cases?: { name: string; expected: string }[];
  };
  candidate?: { id: string; name: string; email: string };
  application_code?: string | null;
  requisition_id?: string | null;
}

export interface RubricAnchorRow {
  id: string;
  blueprint_id: string;
  competency: string;
  version: number;
  observable_behavior: string;
  evidence_requirements: string[];
  anchors: Record<string, string>;
  critical_mistakes: string[];
  insufficient_evidence_conditions: string[];
  skill_mapping: { skill: string; anchor_to_proficiency: Record<string, number> };
}

export interface JudgmentItem {
  competency: string;
  judgment: string;
  evidence_quotes: string[];
  anchor_ref: string;
  uncertainty: number;
  suggested_follow_up: string;
  note?: string;
  reason?: string;
}

export interface AssessmentEvaluation {
  ok: true;
  job_id: string;
  status: string;
  assessment_id: string;
  result: {
    type: string;
    session_id: string;
    session_type: string;
    blueprint_id: string;
    blueprint_title: string;
    competency: string;
    code_execution: { available: boolean; note: string };
    ai: { judgments: JudgmentItem[]; summary: string; evaluated_at: string; evaluator: string; model: string };
    reviewed: { determination: string; judgments: JudgmentItem[]; reason: string; by: string; at: string } | null;
  };
}

export interface AssessmentReviewResult {
  ok: true;
  assessment_id: string;
  reviewed: { determination: string; reason: string; by: string; at: string };
  evidence_written: { competency: string; skill: string; assertion_id: string; evidence_id: string; proficiency: number }[];
  fit: { current: number | null; future: number | null };
}

export const assessmentSessionFetch = (body: { token?: string; session_id?: string }) =>
  invoke<{ ok: true; session: AssessmentSessionView; rubrics?: RubricAnchorRow[]; evaluation?: AssessmentEvaluation["result"] | null }>(
    "assessment-session",
    { action: "fetch", ...body }
  );

export const assessmentSessionCreate = (payload: {
  application_id: string;
  blueprint_id: string;
  session_type: "work_sample" | "interview";
  expires_in_hours?: number;
}) =>
  invoke<{ ok: true; session: AssessmentSessionView; invitation_token: string; expires_at: string }>("assessment-session", {
    action: "create",
    ...payload,
  });

export const assessmentSessionDraft = (token: string, drafts: Record<string, string>, accommodation?: Record<string, unknown>) =>
  invoke<{ ok: true; saved_at: string; status: string }>("assessment-session", {
    action: "draft",
    token,
    drafts,
    accommodation,
  });

export const assessmentSessionSubmit = (token: string, answers: Record<string, string>, accommodation?: Record<string, unknown>) =>
  invoke<{ ok: true; submitted_at: string; submission_hash: string; status: string }>("assessment-session", {
    action: "submit",
    token,
    answers,
    accommodation,
  });

export const assessmentSessionResume = (sessionId: string, followUps: { key?: string; prompt: string }[]) =>
  invoke<{ ok: true; session: AssessmentSessionView; follow_ups_issued: number }>("assessment-session", {
    action: "resume",
    session_id: sessionId,
    follow_ups: followUps,
  });

export const assessmentBlueprintSeed = (requisitionId: string) =>
  invoke<{ ok: true; seeded: { id: string; competency: string; rubrics: number }[] }>("assessment-blueprint", {
    action: "seed",
    requisition_id: requisitionId,
  });

export const assessmentBlueprintList = (requisitionId: string) =>
  invoke<{ ok: true; blueprints: { id: string; requisition_id: string; competency: string; version: number; artifact_spec: { title: string; kind: string; questions: SessionQuestion[] }; test_cases: { name: string; expected: string }[]; rubrics: RubricAnchorRow[] }[] }>(
    "assessment-blueprint",
    { action: "list", requisition_id: requisitionId }
  );

export const assessmentEvaluate = (sessionId: string) =>
  invoke<AssessmentEvaluation>("assessment-evaluate", { session_id: sessionId });

export const assessmentReview = (
  assessmentId: string,
  determination: "confirm" | "override",
  judgments: { competency: string; judgment: string; evidence_quotes: string[]; reason?: string }[],
  reason?: string
) =>
  invoke<AssessmentReviewResult>("assessment-review", { assessment_id: assessmentId, determination, judgments, reason });
