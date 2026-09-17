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
  constructor(message: string, public code?: string) {
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
  if (error) throw new ApiError(error.message || `${name}: failed`, (error as { context?: { error?: string } }).context?.error);
  return data as T;
}

export const extractResume = (twinId: string, resumeText: string, reqId?: string) =>
  invoke<ExtractResumeResult>("extract-resume", { twin_id: twinId, resume_text: resumeText, req_id: reqId });

export const generateRubrics = (reqId: string) =>
  invoke<{ ok: true; rubrics: RubricCompetency[] }>("rubric", { req_id: reqId });

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
  section: string;
  exact_quote: string;
}

export interface PolicyRetrievedChunk {
  doc_code: string;
  doc_title: string;
  section_code: string;
  heading: string;
  text: string;
  score: number;
}

export interface PolicyAnswer {
  status: "grounded" | "partially_supported" | "insufficient_evidence";
  abstained: boolean;
  best_score: number;
  threshold: number;
  answer: string;
  citations: PolicyCitation[];
  retrieval: PolicyRetrievedChunk[];
  note?: string;
}

export const policyAsk = (question: string) =>
  invoke<PolicyAnswer>("policy-qa", { question });

export const escalatePolicy = (question: string, status: string, bestScore: number) =>
  invoke<{ ok: true; recommendation_id: string }>("escalate", { question, status, best_score: bestScore });

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
