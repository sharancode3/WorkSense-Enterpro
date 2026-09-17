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
  skills: { name: string; proficiency: number; evidence_source: string; verification_rigor: string; evidence?: string }[];
  experience: { title: string; years: number; highlights: string[] }[];
  projects: { name: string; description: string; technologies: string[] }[];
  summary: string;
  years_experience: number;
  fit: FitRecordShape | null;
}

export interface RubricCompetency {
  competency: string;
  question: string;
  levels: { tier: string; criteria: string[] }[];
}

export interface InterviewKit {
  type: string;
  req_id: string;
  req_title: string;
  candidate_name: string;
  score: number;
  focus_items: string[];
  probes: { skill: string; questions: string[] }[];
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
  claim: string;
  doc_code: string;
  section: string;
  quote: string;
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
