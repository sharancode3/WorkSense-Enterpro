import { supabase } from "@/integrations/supabase/client";
import type { Role } from "./rbac";
import {
  assessmentQueueSchema,
  candidateCompareSchema,
  decode,
  healthViewSchema,
  interviewKitSchema,
  meResultSchema,
  myWorkSchema,
  onboardingQueueSchema,
  overviewSearchResultSchema,
  policyConversationLinkSchema,
  policyConversationListSchema,
  policyConversationMessagesSchema,
  policyConversationSaveSchema,
  securityAuditResultSchema,
  recommendationCommentListSchema,
  recommendationCommentResultSchema,
  type AssessmentQueueResult,
  type CandidateCompare,
  type OnboardingQueue,
} from "./contracts";
import type { z } from "zod";

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
  ok: true;
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
  return decode(meResultSchema, data, "me");
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

async function invoke<T>(name: string, body: unknown, schema?: z.ZodType<T>, label?: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const ctx = (error as { context?: Record<string, unknown> }).context;
    throw new ApiError(error.message || `${name}: failed`, (ctx?.error as string) ?? undefined, ctx);
  }
  return schema ? decode(schema, data, label ?? name) : (data as T);
}

export const extractResume = (twinId: string, resumeText: string, reqId?: string) =>
  invoke<ExtractResumeResult>("extract-resume", { twin_id: twinId, resume_text: resumeText, req_id: reqId });

export const generateRubrics = (reqId: string, competencies?: string[]) =>
  invoke<{ ok: true; rubrics: RubricCompetency[] }>("rubric", { req_id: reqId, competencies });

export const generateInterviewKit = async (twinId: string, reqId: string) => {
  const res = await invoke<{ ok: true; kit: InterviewKit }>("interview-kit", {
    twin_id: twinId,
    req_id: reqId,
  });
  return { ...res, kit: decode(interviewKitSchema, res.kit, "interview-kit.kit") };
};

export const evaluateInterview = (twinId: string, reqId: string, notes: string) =>
  invoke<{ ok: true; evaluation: InterviewEvaluation }>("evaluate-interview", { twin_id: twinId, req_id: reqId, notes });

export const recruiterDecision = (twinId: string, reqId: string, decision: "move_forward" | "reject" | "select", note?: string) =>
  invoke<{ ok: true; decision: string; applicant?: { twin_id: string; stage: string }; converted?: unknown; note?: string }>(
    "recruiter-decision",
    { twin_id: twinId, req_id: reqId, decision, note }
  );

export interface RequisitionCriterionInput {
  skill: string;
  target_proficiency: number;
  requirement: "required" | "preferred";
  weight: number;
  evidence_expectation: string;
}

export const requisitionCreate = (payload: {
  title: string;
  department: string;
  seniority_level: number;
  required_skills: { skill: string; target_proficiency: number }[];
  future_skills: { skill: string; target_proficiency: number }[];
  criteria?: RequisitionCriterionInput[];
}) =>
  invoke<{ ok: true; requisition: unknown }>("requisition", { action: "create", ...payload });

export const requisitionUpdate = (reqId: string, payload: Partial<{ title: string; department: string; seniority_level: number; criteria: RequisitionCriterionInput[] }>) =>
  invoke<{ ok: true; requisition: unknown; unchanged?: boolean }>("requisition", { action: "update", req_id: reqId, ...payload });

// ---- Phase 4: candidate comparison workspace ----

export const candidateCompare = (reqId: string) =>
  invoke<CandidateCompare>("candidate-compare", { req_id: reqId }, candidateCompareSchema, "candidate-compare");

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

// ---- Phase 8: adaptive onboarding (normalized plan/task model) ----

export type PlanTaskType = "learning" | "verification" | "provisioning" | "policy" | "access" | "onboarding_admin";
export type OwnerRole = "employee" | "manager" | "hr" | "it_security";
export type PlanTaskState = "pending" | "blocked" | "ready" | "in_progress" | "done" | "waived" | "failed";

export interface PlanTaskView {
  task_code: string;
  title: string;
  task_type: PlanTaskType;
  owner_role: OwnerRole;
  required: boolean;
  non_waivable: boolean;
  depends_on: string[];
  duration_days: number;
  due_date: string | null;
  topological_level: number;
  why_evidence: { reason: string; source_evidence: { source_type: string; fact: string; ref?: string }[] };
  evidence_requirements: { kind: "note" | "assessment_id"; label: string; required: boolean }[];
  state: PlanTaskState;
  blocked_reasons: string[];
  blockers: { id: string; note: string; reported_by: string; at: string; status: "open" | "resolved"; resolved_by?: string; resolved_at?: string }[];
  waiver: { by_twin_id: string; by_name: string; reason: string; policy_basis: { doc_code: string; version: number | null } | null; at: string } | null;
  completion_record: {
    actor_twin_id: string;
    actor_name: string;
    at: string;
    evidence: { kind: string; label: string; value: string }[];
    attempt_hash: string;
    note?: string;
  } | null;
  adaptation: { kind: "replaced" | "reopened_gap"; replaced_by?: string; reason: string; source_evidence: { source_type: string; fact: string; ref?: string }[]; at: string; actor_twin_id: string } | null;
}

export interface PlanView {
  id: string;
  twin_id: string;
  application_id: string | null;
  version: number;
  plan_hash: string;
  status: "draft" | "pending_approval" | "approved" | "completed" | "superseded";
  manager_approval: { by: string; by_twin_id: string; at: string } | null;
  hr_approval: { by: string; by_twin_id: string; at: string } | null;
  start_date: string;
  generated_at: string;
  readiness: {
    ready_pct: number;
    satisfied: number;
    total: number;
    remaining_critical_days: number;
    projected_ready_date: string | null;
    blocked_count: number;
    note: string;
    provisional: boolean;
    critical_path: string[];
    dimensions: { key: "access" | "compliance" | "capability"; label: string; satisfied: number; total: number; pct: number; note: string }[];
    working_calendar: "business_days";
  };
  carryover: { task_code: string; from_version: number; from_plan_id: string; note: string }[];
  audit_events: { actor: string; action: string; note?: string; timestamp: string }[];
}

export const onboardingPlanBuild = (twinId: string, regen = false, startDate?: string) =>
  invoke<{ ok: true; plan: PlanView & { tasks: PlanTaskView[]; requisition: { id: string; title: string }; fit_current: number } }>(
    "onboarding-plan",
    { twin_id: twinId, regen, start_date: startDate }
  );

export const onboardingPlanApprove = (planId: string, planHash: string) =>
  invoke<{ ok: true; plan_id: string; version: number; plan_hash: string; status: string; manager_approved: boolean; hr_approved: boolean }>(
    "onboarding-approve",
    { plan_id: planId, plan_hash: planHash }
  );

export interface TaskActionPayload {
  evidence?: { kind: "note" | "assessment_id"; label: string; value: string }[];
  note?: string;
  blocker_id?: string;
  waiver?: { reason?: string; policy_basis?: { doc_code?: string; version?: number | null } | null };
  skill?: string;
  source_evidence?: { source_type: string; fact: string; ref?: string }[];
}

export const onboardingTaskAction = (planId: string, taskCode: string, action: "complete" | "block" | "resolve" | "waive" | "adapt" | "fail", payload: TaskActionPayload = {}) =>
  invoke<{ ok: true; action: string; task_code: string; state?: string; readiness?: PlanView["readiness"]; plan_id?: string; version?: number; status?: string; plan_hash?: string; replaced_by?: string; reopened_by?: string; completion?: unknown; waiver?: unknown; blockers?: unknown[] }>(
    "onboarding-task",
    { plan_id: planId, task_code: taskCode, action, ...payload }
  );

export const onboardingQueue = () =>
  invoke<OnboardingQueue>("onboarding-queue", {}, onboardingQueueSchema, "onboarding-queue");

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

export type PolicyAnswerStatus = "grounded" | "partially_supported" | "insufficient_evidence" | "clarification_needed" | "conflicting_policies";

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
  employee_context?: {
    name?: string;
    work_location?: string;
    worker_type?: string;
    context_source?: { location?: "saved" | "hypothetical"; worker_type?: "saved" | "hypothetical" };
  };
  expired_policy?: { doc_code: string; title: string; effective_to: string | null; score: number };
  excluded_policy?: { doc_code: string; title: string; context: Record<string, unknown> };
  conflict?: { candidates: { doc_code: string; title: string; version?: number; section_code: string; heading: string; score: number; effective_from: string | null; effective_to: string | null }[]; reason: string };
  certainty_note?: string;
}

export interface PolicyContextResult {
  ok: true;
  employees: { id: string; name: string; work_location: string | null; worker_type: string | null }[];
  policies: { id: string; doc_code: string; version: number; title: string; category: string; effective_from: string | null; effective_to: string | null; applicable_locations: string[]; applicable_worker_types: string[] }[];
}

export const policyAsk = (question: string, employeeId?: string, context?: { location?: string; worker_type?: string; taken_days?: number; request_from?: string; request_to?: string; as_of?: string }) =>
  invoke<PolicyAnswer>("policy-qa", { question, employee_id: employeeId, as_of: context?.as_of, context });

export const policyContext = () => invoke<PolicyContextResult>("policy-qa", { action: "context" });

export const escalatePolicy = (question: string, context?: Record<string, unknown>, sources?: unknown[], reason?: string) =>
  invoke<{ ok: true; escalation_id: string; status: string; created_at: string; owner: string; message: string }>(
    "escalate",
    { question, context, sources, reason }
  );

export interface PolicyEscalationRow {
  id: string;
  question: string;
  reason: string | null;
  status: "open" | "in_progress" | "resolved" | "closed";
  owner_twin_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  response_text: string | null;
  responded_by: string | null;
  responded_at: string | null;
  history: { at: string; by: string; action: string; from: string | null; to: string | null; response: string | null }[];
}

export const listEscalations = () => invoke<{ ok: true; escalations: PolicyEscalationRow[] }>("escalate", { action: "list" });

export const respondEscalation = (escalation_id: string, status: string, response_text: string) =>
  invoke<{ ok: true; escalation: PolicyEscalationRow }>("escalate", { action: "respond", escalation_id, status, response_text });

// ---- Batch G: persistent, private policy conversations ----------------------
// Each conversation belongs to one twin (owner-only RLS + server-side
// ownership checks). Saves are idempotent on (conversation_id, request_id).
export interface PolicyConversationRow {
  id: string;
  org_id: string;
  owner_twin_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message: {
    role: string;
    question: string | null;
    answer: unknown;
    escalation_id: string | null;
    created_at: string;
  } | null;
}

export interface PolicyMessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  question: string | null;
  answer: unknown;
  escalation_id: string | null;
  created_at: string;
}

export const policyConversationList = () =>
  invoke<{ ok: true; conversations: PolicyConversationRow[] }>("policy-conversation", { action: "list" }, policyConversationListSchema, "policy-conversation.list");

export const policyConversationMessages = (conversation_id: string) =>
  invoke<{ ok: true; conversation: { id: string; title: string }; messages: PolicyMessageRow[] }>(
    "policy-conversation",
    { action: "messages", conversation_id },
    policyConversationMessagesSchema,
    "policy-conversation.messages"
  );

export const policyConversationSave = (payload: { conversation_id?: string; question: string; answer: PolicyAnswer; request_id: string }) =>
  invoke<{ ok: true; conversation_id: string; message_id: string; created: boolean }>(
    "policy-conversation",
    { action: "save", ...payload },
    policyConversationSaveSchema,
    "policy-conversation.save"
  );

export const policyConversationLinkEscalation = (conversation_id: string, request_id: string, escalation_id: string) =>
  invoke<{ ok: true; message_id: string; escalation_id: string }>(
    "policy-conversation",
    { action: "link-escalation", conversation_id, request_id, escalation_id },
    policyConversationLinkSchema,
    "policy-conversation.link-escalation"
  );

// ---- Batch H (H1): honest security audit feed (admin only) ------------------
export type SecurityAuditKind = "access" | "recruitment" | "recommendations" | "onboarding";

export interface SecurityAuditItem {
  key: string;
  kind: SecurityAuditKind;
  label: string;
  detail: string;
  actor: string | null;
  reason: string | null;
  at: string;
  href: string | null;
}

export interface SecurityAuditResult {
  ok: true;
  total: number;
  page: number;
  page_size: number;
  items: SecurityAuditItem[];
  truncated_sources: string[];
}

export const fetchSecurityAudit = (page: number, page_size: number, kind?: SecurityAuditKind) =>
  invoke<SecurityAuditResult>(
    "security-audit",
    { page, page_size, kind: kind ?? undefined },
    securityAuditResultSchema,
    "security-audit"
  );

// ---- Recommendation & Action Hub (Phase 11 transactional lifecycle) ----

export type RecommendationStatus =
  | "suggested"
  | "needs_review"
  | "approved"
  | "rejected"
  | "execution_pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale";

export interface RecommendationRow {
  id: string;
  twin_id: string | null;
  category: string;
  urgency: string;
  status: RecommendationStatus;
  version: number;
  source_hash: string | null;
  resource_ref: string | null;
  alternatives: { req_id: string; title: string; fit_score: number; coverage: number }[];
  required_approvers: unknown[];
  expires_at: string | null;
  stale: boolean;
  stale_reason: string | null;
  superseded_by: string | null;
  intended_outcome: { review_kind?: string; outcome?: string };
  approved_at: string | null;
  outcomes: { time_to_ready_days?: number; completed_at?: string; reviewer_feedback?: string; task_summary?: { total: number; completed: number; failed: number; cancelled: number }; note?: string };
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

export type TaskStatus = "open" | "in_progress" | "blocked" | "completed" | "failed" | "cancelled";

export interface ActionTaskRow {
  id: string;
  recommendation_id: string | null;
  owner_twin_id: string;
  owner_role: string | null;
  task_code: string | null;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  resource_link: string | null;
  instructions: string | null;
  required_evidence: string[];
  depends_on: string[];
  outcome_measure: Record<string, unknown>;
  verification: { evidence?: string[]; completed_by?: string; at?: string; note?: string };
  outcome: Record<string, unknown>;
  last_error: string | null;
  retry_count: number;
  version: number;
  created_at: string;
}

export interface WorkflowEventRow {
  id: string;
  resource_type: "recommendation" | "action_task";
  resource_id: string;
  actor_role: string | null;
  resource: string | null;
  prior_status: string | null;
  new_status: string | null;
  reason: string | null;
  source_version: string | null;
  request_id: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface RecommendationCommentRow {
  id: string;
  recommendation_id: string;
  actor_twin_id: string;
  actor_role: string | null;
  body: string;
  visibility: "all" | "approvers";
  created_at: string;
}

export const recommendationScan = () =>
  invoke<{ ok: true; scanned_candidates: number; created: number; unchanged: number; made_stale: number; created_ids: string[] }>("recommendation-scan", {});

export const recommendationReview = (recId: string, action: string, rationale: string, requestId?: string, supersededBy?: string, message?: string) =>
  invoke<{ ok: true; request_id: string; prior_status: string; status: string; idempotent: boolean; effect?: string | null }>(
    "recommendation-review",
    { rec_id: recId, action, rationale, request_id: requestId, superseded_by: supersededBy, message }
  );

export const recommendationExecute = (recId: string, action: string, rationale: string, requestId?: string, reviewerFeedback?: string, evidence?: string[], message?: string) =>
  invoke<{ ok: true; request_id: string; prior_status: string; status: string; created_tasks: number; idempotent: boolean; effect?: string | null }>(
    "recommendation-execute",
    { rec_id: recId, action, rationale, request_id: requestId, reviewer_feedback: reviewerFeedback, evidence, message }
  );

export const recommendationCommentAdd = (recId: string, comment: string, visibility: "all" | "approvers" = "all") =>
  invoke<{ ok: true; comment: RecommendationCommentRow }>(
    "recommendation-comment",
    { action: "add", rec_id: recId, comment, visibility },
    recommendationCommentResultSchema,
    "recommendation-comment.add"
  );

export const recommendationCommentList = (recId: string) =>
  invoke<{ ok: true; comments: RecommendationCommentRow[] }>(
    "recommendation-comment",
    { action: "list", rec_id: recId },
    recommendationCommentListSchema,
    "recommendation-comment.list"
  );

export const actionTaskUpdate = (taskId: string, action: string, rationale: string, requestId?: string, evidence?: string[], outcome?: Record<string, unknown>) =>
  invoke<{ ok: true; request_id: string; prior_status: string; status: string; recommendation_status: string | null; idempotent: boolean }>(
    "action-task-update",
    { task_id: taskId, action, rationale, request_id: requestId, evidence, outcome }
  );

// ---- Executive Decision Dashboard ----

export interface DashboardFilters {
  department?: string | null;
  requisition_id?: string | null;
  period?: string | null;
  review_band?: "low" | "medium" | "high" | "review" | null;
  min_completeness?: number | null;
}

export interface HeatmapBucket {
  skill: string;
  target_proficiency: number;
  req_id: string;
  req_title: string;
  buckets: {
    missing: number;
    below_target: number;
    adjacent_support: number;
    insufficient_evidence: number;
    ready: number;
  };
  total: number;
}

export interface DashboardData {
  ok: true;
  scope: "org" | "team";
  threshold: number;
  computed_at: string;
  period: { label: string; start: string | null; end: string | null; filtered: boolean };
  observation_range: { start: string; end: string } | null;
  definitions: {
    headcount: string;
    open_requisitions: string;
    active_candidates: string;
    journeys: string;
    heatmap: string;
  };
  filters: {
    applied: { department: string | null; requisition_id: string | null; period: string | null };
    available: {
      departments: string[];
      requisitions: { id: string; title: string; status: string }[];
    };
  };
  cards: {
    headcount: number;
    open_requisitions: number;
    requisition_statuses: Record<string, number>;
    active_candidates: number;
    journeys_in_progress: number;
    journeys_on_track: number;
    journeys_blocked: number;
    review_priority_cases: number;
    pending_recommendations: number;
  };
  review_cases: ReviewCaseRow[];
  hiring_funnel: { stage: string; count: number }[];
  review_band_counts: { low: number; medium: number; high: number; review: number; total: number };
  heatmap: HeatmapBucket[];
  recommendations: { id: string; category: string; urgency: string; title: string; executive_summary: string }[];
}

export const fetchDashboard = (filters?: DashboardFilters) =>
  invoke<DashboardData>("dashboard", { ...filters });

// ---- Phase 15: Access administration console ----

export type AdminActionName = "invite" | "update_role" | "suspend" | "reactivate";

export interface AdminActionRow {
  id: string;
  action: AdminActionName;
  actor_twin_id: string;
  target_twin_id: string | null;
  target_email: string | null;
  before_data: Record<string, unknown>;
  after_data: Record<string, unknown>;
  reason: string | null;
  created_at: string;
}

export const ADMIN_ASSIGNABLE_ROLES = ["hr_executive", "manager", "recruiter", "employee"] as const;

export const adminAccessInvite = (email: string, role: string, name: string, reason?: string) =>
  invoke<{ ok: true; twin_id: string; role: string; email: string }>("admin-access", { action: "invite", email, role, name, reason });

export const adminAccessUpdateRole = (targetTwinId: string, role: string, reason: string) =>
  invoke<{ ok: true; twin_id: string; before: { role: string }; after: { role: string } }>("admin-access", { action: "update_role", target_twin_id: targetTwinId, role, reason });

export const adminAccessSuspend = (targetTwinId: string, reason: string) =>
  invoke<{ ok: true; twin_id: string; status: "suspended" }>("admin-access", { action: "suspend", target_twin_id: targetTwinId, reason });

export const adminAccessReactivate = (targetTwinId: string, reason: string) =>
  invoke<{ ok: true; twin_id: string; status: "active" }>("admin-access", { action: "reactivate", target_twin_id: targetTwinId, reason });

// ---- Phase 10: constrained staffing planner ----

export type PlannerStatus = "feasible" | "conditional" | "infeasible" | "insufficient_data";

export interface PlannerSkillRow {
  skill: string;
  min_proficiency: number;
  mandatory: boolean;
  coverage: "verified" | "conditional" | "gap" | "absent";
  current_proficiency: number | null;
  projected_proficiency: number | null;
  source: string;
  mandatory_satisfied: boolean;
}

export interface PlannerOption {
  id: "hire" | "move" | "upskill" | "hybrid";
  label: string;
  status: PlannerStatus;
  status_reason: string;
  skill_coverage: PlannerSkillRow[];
  verified_coverage_pct: number;
  conditional_coverage_pct: number;
  mandatory_satisfied: boolean;
  mandatory_missing: string[];
  timeline: { name: string; kind: string; duration_days: number; parallel: boolean }[];
  ready_at_days: number;
  meets_deadline: boolean;
  cost_usd: number;
  budget_satisfied: boolean;
  dependency_risk: "low" | "medium" | "high";
  constraints_satisfied: string[];
  constraints_violated: string[];
  rationale: string;
  subject?: string;
}

export interface StaffingPlanInput {
  name?: string;
  demand_title?: string;
  department?: string;
  required_skills?: { skill: string; min_proficiency: number; mandatory?: boolean }[];
  capacity_people?: number;
  deadline_days?: number;
  budget_usd?: number;
  geography?: string;
  horizon_months?: number;
  assumptions_version?: string;
}

export interface StaffingPlanResult {
  ok: true;
  scenario_id: string;
  scope: "team" | "org";
  population_size: number;
  candidate_pipeline_size: number | null;
  scenario: StaffingPlanInput & { name: string; demand_title: string; deadline_days: number; budget_usd: number };
  assumptions: { version: string; hire_lead_days: number; hire_cost_usd: number; move_transition_days: number; move_cost_usd: number; manager_approval_days: number; training_days_per_skill: number; training_cost_usd_per_skill: number; verification_days: number; candidate_stale_days: number };
  options: PlannerOption[];
  decision_table: { option_id: string; cost_usd: number; ready_at_days: number; verified_coverage_pct: number; conditional_coverage_pct: number; status: PlannerStatus }[];
  note: string;
}

export const planStaffing = (input: StaffingPlanInput = {}) =>
  invoke<StaffingPlanResult>("staffing-comparison", { action: "plan", ...input });

export const listStaffingScenarios = () =>
  invoke<{
    ok: true;
    scenarios: { id: string; name: string; input_snapshot: unknown; assumptions: unknown; result: unknown; created_by: string | null; created_at: string }[];
    proposals: {
      id: string;
      scenario_id: string | null;
      status: string;
      review_note: string | null;
      option_label: string | null;
      scenario_version: string | null;
      submitted_by: string | null;
      submitted_by_name: string | null;
      reviewed_by: string | null;
      reviewed_by_name: string | null;
      reviewed_at: string | null;
      created_at: string;
    }[];
  }>("staffing-comparison", { action: "list" });

export const reviewStaffingProposal = (proposal_id: string, decision: "approved" | "declined", review_note?: string) =>
  invoke<{
    ok: true;
    proposal: {
      id: string;
      status: string;
      option_label: string | null;
      scenario_version: string | null;
      review_note: string | null;
      submitted_by: string | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
      created_at: string;
    };
    message: string;
  }>("staffing-comparison", { action: "review_proposal", proposal_id, decision, review_note: review_note ?? "" });

export const proposeStaffingScenario = (scenario_id: string, option_id: string) =>
  invoke<{ ok: true; proposal_id: string; status: string; message: string; option_id: string; option_label: string; scenario_version: string }>(
    "staffing-comparison",
    { action: "propose", scenario_id, option_id }
  );

export const explainStaffingScenario = (scenario_id: string) =>
  invoke<{ ok: true; explanation: string | null; digest: unknown; error?: string }>("staffing-comparison", { action: "explain", scenario_id });

// ---- Batch F: authorized overview search (people / candidates / roles) ----
// Scope (org vs team) and the candidate/requisition groups are decided
// server-side from the caller's role. Actions/module links are static UI
// navigation and are assembled client-side from the RBAC-driven nav.
export interface OverviewSearchResult {
  ok: true;
  q: string;
  scope: "org" | "team";
  people: { id: string; name: string; job_title: string | null; department: string | null; role: string }[];
  candidates: { id: string; name: string; department: string | null }[];
  roles: { id: string; title: string; department: string | null; status: string }[];
}

export const fetchOverviewSearch = (q: string) =>
  invoke<OverviewSearchResult>("overview-search", { q }, overviewSearchResultSchema, "overview-search");

// ---- Phase 9: Workforce Review Index + Performance Summaries ----

export interface ReviewFactor {
  score: number;
  weight: number;
  definition: string;
  source_period: string | null;
  note: string | null;
}

export interface ReviewTrend {
  metric: string;
  direction: "up" | "down" | "flat" | "insufficient";
  delta: number | null;
  first: number | null;
  last: number | null;
  periods: string[];
  favorable_direction?: "up" | "down";
  favorable?: boolean;
}

export interface ReviewAction {
  id: string;
  action: "acknowledged" | "dismissed" | "deferred";
  reason: string;
  follow_up_at: string | null;
  acted_by: string;
  acted_at: string;
}

export interface ReviewOutcome {
  action_id: string;
  action: string;
  metric: string;
  before_mean: number;
  after_mean: number;
  delta: number;
  observed_after: string;
  note: string;
}

export interface WorkforceReviewResult {
  ok: true;
  cached?: boolean;
  index: number;
  priority: "low" | "medium" | "high" | "review";
  factors: Record<"career" | "attendance" | "delivery" | "engagement", ReviewFactor>;
  trend: ReviewTrend[];
  data_completeness: number;
  missing_data: { metric: string; periods: string[] }[];
  seeking_growth: boolean;
  priority_gate?: { tier_capped: boolean; reason: string | null };
  recommended_fact_finding: string[];
  sensitivity: { individual_absence: boolean; individual_engagement: boolean };
  limitations: string[];
  confidence: "high" | "medium" | "low";
  confidence_reason: string;
  history_state: "none" | "partial" | "adequate";
  data_quality: { issues: { kind: string; detail: string }[]; severity: "ok" | "warning" | "critical" };
  freshness: { oldest_observation_period: string | null; latest_observation_period: string | null; months_since_latest: number | null; stale: boolean; computed_at: string };
  case_rationale: { factor: string; why: string }[];
  actions?: ReviewAction[];
  outcomes?: ReviewOutcome[];
  label: string;
}

export const fetchWorkforceReview = (twinId: string, force = false) =>
  invoke<WorkforceReviewResult>("workforce-review-index", { twin_id: twinId, force });

export const workforceReviewAction = (payload: { twin_id: string; action: "acknowledged" | "dismissed" | "deferred"; reason: string; follow_up_at?: string | null }) =>
  invoke<{ ok: true; action: ReviewAction; outcome_note: string }>("workforce-review-action", payload);

export interface PerfSourceFact {
  ref: string;
  source: string;
  fact: string;
  period?: string | null;
}

export interface PerfContradiction {
  title: string;
  evidence: string[];
}

export interface PerfDevelopmentAction {
  skill: string;
  gap_basis: string[];
  action: string;
  measurable_evidence: string;
}

export interface PerformanceSummaryResult {
  ok: true;
  cached?: boolean;
  period: string;
  facts: {
    source_facts: PerfSourceFact[];
    goal_stats: { cycles: number; avg: number | null; min: number | null; max: number | null; note: string };
    feedback_stats: { total: number; positive: number; negative: number; mixed: number; neutral: number; by_cycle: { cycle: string; positive: number; negative: number }[]; note: string };
    evidence_summary: { source_type: string; count: number }[];
    contradictions: PerfContradiction[];
    sparse_evidence: { flags: string[] };
    inferred_themes: { theme: string; basis: string[]; confidence_note: string }[];
    source_version_hash: string;
    history_state: "none" | "partial" | "adequate";
    stale_evidence: { kind: string; detail: string }[];
    evidence_gaps: { skill: string; proficiency: number | null; gap: string }[];
    work_artifacts: { source_type: string; quote: string; captured_at: string | null; period: string | null }[];
  };
  summary: {
    narrative: string;
    source_facts: PerfSourceFact[];
    inferred_themes: { theme: string; basis: string[]; inference?: boolean; confidence_note?: string }[];
    contradictions: PerfContradiction[];
    sparse_evidence: { flags: string[] };
    model_note: string;
    strengths?: string[];
    improvement_areas?: string[];
    development_actions?: PerfDevelopmentAction[];
    reviewer_draft?: Record<string, unknown>;
    reviewer_draft_at?: string | null;
  };
}

export const fetchPerformanceSummary = (twinId: string, force = false) =>
  invoke<PerformanceSummaryResult>("performance-summary", { twin_id: twinId, force });

export const savePerformanceDraft = (twinId: string, period: string, draft: Record<string, unknown>) =>
  invoke<{ ok: true; saved_at: string; reviewer_draft: Record<string, unknown>; label: string }>("performance-draft", {
    twin_id: twinId,
    period,
    draft,
  });

export interface ReviewCaseRow {
  twin_id: string;
  name: string;
  index: number;
  priority: string;
  completeness: number;
  confidence?: "high" | "medium" | "low";
  history_state?: "none" | "partial" | "adequate";
  seeking_growth: boolean;
}

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

export const fetchHealth = () => invoke<HealthView>("health", {}, healthViewSchema, "health");

// ---- Phase 3: unified "My work" feed ----

export type WorkItemType =
  | "onboarding_task"
  | "provisioning_request"
  | "recommendation_task"
  | "approval_request"
  | "review_case"
  | "candidate_next_step"
  | "assessment_session"
  | "requisition_attention"
  | "data_quality_alert"
  | "policy_escalation";

export type WorkGroup = "attention" | "ready" | "waiting";

export interface WorkItem {
  id: string;
  type: WorkItemType;
  title: string;
  subject: string;
  subject_id: string;
  owner: string;
  owner_label: string;
  authorized_actions: string[];
  group: WorkGroup;
  status_label: string;
  due_at: string | null;
  priority_reason: string | null;
  blocker: string | null;
  source: { workflow: string; version: number | null; ref_id: string };
  deep_link: string;
}

export interface MyWorkResult {
  ok: true;
  role: string;
  summary: { attention: number; ready: number; waiting: number };
  items: WorkItem[];
  generated_at: string;
}

export const fetchMyWork = () => invoke<MyWorkResult>("my-work", {}, myWorkSchema, "my-work");

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
  warnings?: { conflicts?: string[]; overlaps?: string[] };
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
  provenance?: {
    artifact_ref: string;
    file_name: string;
    checksum_short: string;
    source_type: string;
  };
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
  is_core?: boolean;
  /** Reviewer view only — never returned to candidates. */
  criteria?: string[];
  answer_key?: string | null;
}

export interface AssessmentSessionView {
  id: string;
  session_type: "work_sample" | "interview" | "knowledge_assessment";
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
  override_from?: string;
  /** Phase 5: separate correctness / reasoning / trade_offs / communication. */
  dimensions?: Partial<Record<"correctness" | "reasoning" | "trade_offs" | "communication", string>>;
  /** Server-computed: route to human confirmation before this may support evidence. */
  review_required?: boolean;
}

export interface AssessmentEvaluation {
  ok: true;
  job_id: string;
  status: string;
  assessment_id: string;
  result: {
    type: string;
    assessment_id: string;
    session_id: string;
    session_type: string;
    blueprint_id: string;
    blueprint_title: string;
    competency: string;
    code_execution: { available: boolean; note: string };
    ai: { judgments: JudgmentItem[]; summary: string; evaluated_at: string; evaluator: string; model: string };
    review_required: boolean;
    reviewed: {
      determination: string;
      judgments: JudgmentItem[];
      reason: string;
      overrides?: { competency: string; from: string | null; to: string; reason: string }[];
      by: string;
      at: string;
    } | null;
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
  session_type: "work_sample" | "interview" | "knowledge_assessment";
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

// ---- Batch 5: hiring-level work queue --------------------------------------

export const assessmentQueue = () =>
  invoke<AssessmentQueueResult>("assessment-queue", {}, assessmentQueueSchema, "assessment-queue");
