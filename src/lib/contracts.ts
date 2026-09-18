// Phase 0: safe decoding of backend JSON — unknown -> validated schema -> typed contract.
//
// Schemas here are STRICT by design: a payload must satisfy the required
// contract surface (ids, enums, required fields) or `decode` fails loudly.
// The known runtime variance of real data is handled at the call sites by a
// small explicit normalizer (e.g. columns that genuinely do not exist), never
// by silently loosening the contract. This is what makes mismatched payloads
// visible instead of cast into the app.
import { z } from "zod";
import type {
  HealthView,
  InterviewKit,
  MeResult,
  MyWorkResult,
  OverviewSearchResult,
  PlanTaskView,
  PlanView,
  RecommendationCommentRow,
  RecommendationRow,
  SecurityAuditResult,
  StaffingPlanResult,
} from "./api";

/**
 * Validate `unknown` against `schema` and return the typed value.
 * Throws with a readable, label-prefixed message on contract violation.
 */
export function decode<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`${label}: contract check failed (${detail}); refusing unsafe payload.`);
  }
  return result.data;
}

/** Optional decode that never throws — used where a partial/absent payload is legitimate. */
export function tryDecode<T>(schema: z.ZodType<T>, value: unknown, label: string): T | null {
  const result = schema.safeParse(value);
  if (!result.success) return null;
  return result.data;
}

// ---------------------------------------------------------------------------
// Raw DB row contracts (supabase `.select("*")` returns these as Json fields).
// ---------------------------------------------------------------------------

export const reqSkillSchema = z.object({
  skill: z.string(),
  target_proficiency: z.number(),
});

export const requisitionCriterionSchema = z.object({
  skill: z.string(),
  target_proficiency: z.number().int().min(1).max(5),
  requirement: z.enum(["required", "preferred"]),
  weight: z.number().min(0).max(1),
  evidence_expectation: z.string(),
});
export type RequisitionCriterion = z.infer<typeof requisitionCriterionSchema>;

export const applicantRowSchema = z.object({
  twin_id: z.string(),
  stage: z.string(),
  match_score: z.number().nullable(),
});

export const requisitionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string(),
  status: z.string(),
  seniority_level: z.number(),
  required_skills: z.array(reqSkillSchema),
  future_skills: z.array(reqSkillSchema),
  applicants: z.array(applicantRowSchema),
  requisition_criteria: z.array(requisitionCriterionSchema).default([]),
  rubrics: z.array(z.unknown()).optional(),
});
export type RequisitionRow = z.infer<typeof requisitionRowSchema>;

export const candidateRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  role: z.string(),
  status: z.string(),
});
export type CandidateRow = z.infer<typeof candidateRowSchema>;

// Phase 4: candidate comparison (scored / unscored / stale buckets).
export const candidateCompareRowSchema = z.object({
  twin_id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  stage: z.string(),
  version: z.number(),
  application_code: z.string(),
  applied_at: z.string(),
  status: z.enum(["scored", "unscored", "stale"]),
  score: z.number().nullable(),
  score_at: z.string().nullable(),
  gaps: z.array(z.string()),
  adjacent: z.array(z.string()),
  transferable: z.array(z.string()),
});
export type CandidateCompareRow = z.infer<typeof candidateCompareRowSchema>;

export const candidateCompareSchema = z.object({
  ok: z.literal(true),
  req_id: z.string(),
  req_title: z.string(),
  criteria: z.array(requisitionCriterionSchema).default([]),
  rows: z.array(candidateCompareRowSchema),
  scored_count: z.number(),
  unscored_count: z.number(),
  stale_count: z.number(),
}) as z.ZodType<CandidateCompare>;
export interface CandidateCompare {
  ok: true;
  req_id: string;
  req_title: string;
  criteria: RequisitionCriterion[];
  rows: CandidateCompareRow[];
  scored_count: number;
  unscored_count: number;
  stale_count: number;
}

// ---------------------------------------------------------------------------
// Onboarding adaptive plan contracts (plan + tasks).
// ---------------------------------------------------------------------------

const approvalRefSchema = z.object({ by: z.string(), by_twin_id: z.string(), at: z.string() });
const sourceEvidenceSchema = z.object({ source_type: z.string(), fact: z.string(), ref: z.string().optional() });

export const readinessDimensionSchema = z.object({
  key: z.enum(["access", "compliance", "capability"]),
  label: z.string(),
  satisfied: z.number(),
  total: z.number(),
  pct: z.number(),
  note: z.string(),
});

export const planViewSchema = z.object({
  id: z.string(),
  twin_id: z.string(),
  application_id: z.string().nullable(),
  version: z.number(),
  plan_hash: z.string(),
  status: z.enum(["draft", "pending_approval", "approved", "completed", "superseded"]),
  manager_approval: approvalRefSchema.nullable(),
  hr_approval: approvalRefSchema.nullable(),
  start_date: z.string(),
  generated_at: z.string(),
  readiness: z.object({
    ready_pct: z.number(),
    satisfied: z.number(),
    total: z.number(),
    remaining_critical_days: z.number(),
    projected_ready_date: z.string().nullable(),
    blocked_count: z.number(),
    note: z.string(),
    provisional: z.boolean().default(false),
    critical_path: z.array(z.string()).default([]),
    dimensions: z.array(readinessDimensionSchema).default([]),
    working_calendar: z.enum(["business_days"]).default("business_days"),
  }),
  carryover: z.array(z.object({ task_code: z.string(), from_version: z.number(), from_plan_id: z.string(), note: z.string() })),
  audit_events: z.array(z.object({ actor: z.string(), action: z.string(), note: z.string().optional(), timestamp: z.string() }))}) as z.ZodType<PlanView>;

export const planTaskViewSchema = z.object({
  task_code: z.string(),
  title: z.string(),
  task_type: z.enum(["learning", "verification", "provisioning", "policy", "access", "onboarding_admin"]),
  owner_role: z.enum(["employee", "manager", "hr", "it_security"]),
  required: z.boolean(),
  non_waivable: z.boolean(),
  depends_on: z.array(z.string()),
  duration_days: z.number(),
  due_date: z.string().nullable(),
  topological_level: z.number(),
  why_evidence: z.object({ reason: z.string(), source_evidence: z.array(sourceEvidenceSchema) }),
  evidence_requirements: z.array(z.object({ kind: z.enum(["note", "assessment_id"]), label: z.string(), required: z.boolean() })),
  state: z.enum(["pending", "blocked", "ready", "in_progress", "done", "waived", "failed"]),
  // NOTE: onboarding_tasks has NO blocked_reasons column; the query normalizer
  // injects [] for every row before this schema runs.
  blocked_reasons: z.array(z.string()),
  blockers: z.array(z.object({ id: z.string(), note: z.string(), reported_by: z.string(), at: z.string(), status: z.enum(["open", "resolved"]), resolved_by: z.string().optional(), resolved_at: z.string().optional() })),
  waiver: z
    .object({
      by_twin_id: z.string(),
      by_name: z.string(),
      reason: z.string(),
      policy_basis: z.object({ doc_code: z.string(), version: z.number().nullable() }).nullable(),
      at: z.string(),
    })
    .nullable(),
  completion_record: z
    .object({
      actor_twin_id: z.string(),
      actor_name: z.string(),
      at: z.string(),
      evidence: z.array(z.object({ kind: z.string(), label: z.string(), value: z.string() })),
      attempt_hash: z.string(),
      note: z.string().optional(),
    })
    .nullable(),
  adaptation: z
    .object({
      kind: z.enum(["replaced", "reopened_gap"]),
      replaced_by: z.string().optional(),
      reason: z.string(),
      source_evidence: z.array(sourceEvidenceSchema),
      at: z.string(),
      actor_twin_id: z.string(),
    })
    .nullable()}) as z.ZodType<PlanTaskView>;

// ---------------------------------------------------------------------------
// Onboarding operational queue (Phase 6) — role-scoped journeys + filters.
// ---------------------------------------------------------------------------

const queueTaskRefSchema = z.object({
  task_code: z.string(),
  title: z.string(),
  task_type: z.string(),
  owner_role: z.string(),
  state: z.string(),
  due_date: z.string().nullable(),
  topological_level: z.number(),
  plan_id: z.string(),
  twin_id: z.string(),
  depends_on: z.array(z.string()).optional(),
  blockers: z.array(z.object({ status: z.string(), at: z.string() })).optional(),
  evidence_requirements: z.array(z.unknown()).optional(),
});

export const onboardingQueueSchema = z.object({
  ok: z.literal(true),
  role: z.enum(["employee", "manager", "hr", "it_security"]),
  journeys: z.array(
    z.object({
      twin_id: z.string(),
      employee_name: z.string(),
      job_title: z.string().nullable(),
      department: z.string().nullable(),
      manager_id: z.string().nullable(),
      plan_id: z.string(),
      version: z.number(),
      status: z.string(),
      start_date: z.string(),
      readiness_pct: z.number(),
      projected_ready_date: z.string().nullable(),
      provisional: z.boolean(),
      blocked_count: z.number(),
      completed_tasks: z.number(),
      total_tasks: z.number(),
      gates: z.array(z.object({ key: z.string(), label: z.string(), pct: z.number() })).default([]),
      pending_manager_approval: z.boolean(),
      pending_hr_approval: z.boolean(),
      overdue: z.boolean(),
      overdue_count: z.number(),
      stalled: z.boolean(),
      stall_reasons: z.array(z.string()),
      viewer_actions: z.array(queueTaskRefSchema),
      waiting_on: z.array(queueTaskRefSchema),
    })
  ),
  provisioning: z.array(queueTaskRefSchema),
  // IT-only minimal identity projection: never readiness/gates/approvals.
  people: z
    .array(
      z.object({
        twin_id: z.string(),
        name: z.string(),
        start_date: z.string().nullable(),
        manager_name: z.string().nullable(),
      })
    )
    .default([]),
  filters: z.object({ all: z.number(), pending_approval: z.number(), overdue: z.number(), stalled: z.number() }),
}) as z.ZodType<OnboardingQueue>;
export interface OnboardingQueue {
  ok: true;
  role: "employee" | "manager" | "hr" | "it_security";
  journeys: QueueJourney[];
  provisioning: QueueTaskRef[];
  people: { twin_id: string; name: string; start_date: string | null; manager_name: string | null }[];
  filters: { all: number; pending_approval: number; overdue: number; stalled: number };
}
export interface QueueTaskRef {
  task_code: string;
  title: string;
  task_type: string;
  owner_role: string;
  state: string;
  due_date: string | null;
  topological_level: number;
  plan_id: string;
  twin_id: string;
  depends_on?: string[];
  blockers?: { status: string; at: string }[];
  evidence_requirements?: unknown[];
}
export interface QueueJourney {
  twin_id: string;
  employee_name: string;
  job_title: string | null;
  department: string | null;
  manager_id: string | null;
  plan_id: string;
  version: number;
  status: string;
  start_date: string;
  readiness_pct: number;
  projected_ready_date: string | null;
  provisional: boolean;
  blocked_count: number;
  completed_tasks: number;
  total_tasks: number;
  gates: { key: string; label: string; pct: number }[];
  pending_manager_approval: boolean;
  pending_hr_approval: boolean;
  overdue: boolean;
  overdue_count: number;
  stalled: boolean;
  stall_reasons: string[];
  viewer_actions: QueueTaskRef[];
  waiting_on: QueueTaskRef[];
}

// ---------------------------------------------------------------------------
// Recommendation hub row contract.
// ---------------------------------------------------------------------------

export const recommendationRowSchema = z.object({
  id: z.string(),
  twin_id: z.string().nullable(),
  category: z.string(),
  urgency: z.string(),
  status: z.enum([
    "suggested",
    "needs_review",
    "approved",
    "rejected",
    "execution_pending",
    "in_progress",
    "completed",
    "failed",
    "cancelled",
    "stale",
  ]),
  version: z.number(),
  source_hash: z.string().nullable(),
  resource_ref: z.string().nullable(),
  alternatives: z.array(z.object({ req_id: z.string(), title: z.string(), fit_score: z.number(), coverage: z.number() })),
  required_approvers: z.array(z.unknown()),
  expires_at: z.string().nullable(),
  stale: z.boolean(),
  stale_reason: z.string().nullable(),
  superseded_by: z.string().nullable(),
  intended_outcome: z.object({ review_kind: z.string().optional(), outcome: z.string().optional() }),
  outcomes: z.object({
    time_to_ready_days: z.number().optional(),
    completed_at: z.string().optional(),
    reviewer_feedback: z.string().optional(),
    task_summary: z
      .object({ total: z.number(), completed: z.number(), failed: z.number(), cancelled: z.number() })
      .optional(),
    note: z.string().optional(),
  }),
  evidence_ledger: z.array(z.object({ source: z.string(), fact: z.string() })),
  proposed_action: z.object({
    title: z.string(),
    description: z.string(),
    steps: z.array(z.object({ order: z.number(), action: z.string() })),
    executive_summary: z.string().optional(),
    recommended_action: z.string().optional(),
  }),
  executive_summary: z.string(),
  required_signoff_role: z.string().nullable(),
  reviewer_rationale: z.object({ last: z.string().optional(), by: z.string().optional(), at: z.string().optional() }),
  audit_events: z.array(
    z.object({
      actor: z.string(),
      action: z.string(),
      rationale: z.string().optional(),
      before: z.string().optional(),
      after: z.string().optional(),
      note: z.string().optional(),
      timestamp: z.string(),
    })
  ),
  approved_at: z.string().nullable(),
  created_at: z.string()}) as z.ZodType<RecommendationRow>;

// Batch C (C2): recommendation comment rows returned by the backend function.
export const recommendationCommentRowSchema = z.object({
  id: z.string(),
  recommendation_id: z.string(),
  actor_twin_id: z.string(),
  actor_role: z.string().nullable(),
  body: z.string(),
  visibility: z.enum(["all", "approvers"]),
  created_at: z.string(),
}) as z.ZodType<RecommendationCommentRow>;

export const recommendationCommentResultSchema = z.object({
  ok: z.literal(true),
  comment: recommendationCommentRowSchema,
}) as z.ZodType<{ ok: true; comment: RecommendationCommentRow }>;

export const recommendationCommentListSchema = z.object({
  ok: z.literal(true),
  comments: z.array(recommendationCommentRowSchema),
}) as z.ZodType<{ ok: true; comments: RecommendationCommentRow[] }>;

// ---------------------------------------------------------------------------
// Wire contracts (validated inside api.ts on the way into the app).
// ---------------------------------------------------------------------------

const skillClaimSchema = z.object({
  name: z.string(),
  proficiency: z.number(),
  evidence_source: z.string(),
  verification_rigor: z.string(),
});

export const meResultSchema = z.object({
  ok: z.literal(true),
  user: z.object({ id: z.string(), email: z.string().optional() }),
  twin: z.object({
    id: z.string(),
    org_id: z.string().nullable(),
    auth_user_id: z.string().nullable(),
    role: z.enum(["hr_executive", "hr_partner", "manager", "recruiter", "employee", "candidate", "it_security"]),
    status: z.string(),
    name: z.string(),
    email: z.string(),
    department: z.string().nullable(),
    job_title: z.string().nullable(),
    manager_id: z.string().nullable(),
    tenure_months: z.number(),
    verified_skills: z.array(skillClaimSchema),
    interview_rubrics: z.array(z.unknown()),
    performance_history: z.array(z.unknown()),
    signals: z.array(z.unknown()),
    computed_fits: z.array(z.unknown()),
    audit_events: z.array(z.unknown()),
  })}) as z.ZodType<MeResult>;

const rubricTiersSchema = z.object({ tier_1: z.string(), tier_2: z.string(), tier_3: z.string(), tier_4: z.string(), tier_5: z.string() });
const rubricCompetencySchema = z.object({
  competency: z.string(),
  question: z.string(),
  follow_up_probes: z.array(z.string()),
  rubric: rubricTiersSchema,
});

export const interviewKitSchema = z.object({
  type: z.string(),
  req_id: z.string(),
  req_title: z.string(),
  candidate_name: z.string(),
  score: z.number(),
  focus_items: z.array(z.string()),
  biased_probe: rubricCompetencySchema.nullable(),
  competencies: z.array(rubricCompetencySchema),
  created_at: z.string()}) as z.ZodType<InterviewKit>;

export const healthViewSchema = z.object({
  ok: z.literal(true),
  app_backend: z.string(),
  gateway: z.enum(["reachable", "unreachable"]),
  model_ready: z.boolean(),
  gateway_authenticated: z.boolean(),
  model: z.string()}) as z.ZodType<HealthView>;

// ---------------------------------------------------------------------------
// Unified "My work" feed contract (Phase 3).
// ---------------------------------------------------------------------------

const workItemSchema = z.object({
  id: z.string(),
  type: z.enum([
    "onboarding_task",
    "provisioning_request",
    "recommendation_task",
    "approval_request",
    "review_case",
    "candidate_next_step",
    "assessment_session",
    "requisition_attention",
    "data_quality_alert",
    "policy_escalation",
  ]),
  title: z.string(),
  subject: z.string(),
  subject_id: z.string(),
  owner: z.string(),
  owner_label: z.string(),
  authorized_actions: z.array(z.string()),
  group: z.enum(["attention", "ready", "waiting"]),
  status_label: z.string(),
  due_at: z.string().nullable(),
  priority_reason: z.string().nullable(),
  blocker: z.string().nullable(),
  source: z.object({ workflow: z.string(), version: z.number().nullable(), ref_id: z.string() }),
  deep_link: z.string(),
});

export const myWorkSchema = z.object({
  ok: z.literal(true),
  role: z.string(),
  summary: z.object({ attention: z.number(), ready: z.number(), waiting: z.number() }),
  items: z.array(workItemSchema),
  generated_at: z.string(),
}) as z.ZodType<MyWorkResult>;

// Phase 10: constrained staffing planner result contract (validated shape).
export const staffingPlannerResultSchema = z.object({
  ok: z.literal(true),
  scenario_id: z.string(),
  scope: z.enum(["team", "org"]),
  options: z.array(
    z.object({
      id: z.enum(["hire", "move", "upskill", "hybrid"]),
      label: z.string(),
      status: z.enum(["feasible", "conditional", "infeasible", "insufficient_data"]),
      ready_at_days: z.number(),
      cost_usd: z.number(),
      verified_coverage_pct: z.number(),
      mandatory_satisfied: z.boolean(),
    })
  ),
  decision_table: z.array(z.object({ option_id: z.string(), status: z.enum(["feasible", "conditional", "infeasible", "insufficient_data"]) })),
  note: z.string(),
}) as unknown as z.ZodType<StaffingPlanResult>;

// Batch F (F1): authorized overview search result contract.
export const overviewSearchResultSchema = z.object({
  ok: z.literal(true),
  q: z.string(),
  scope: z.enum(["org", "team"]),
  people: z.array(z.object({ id: z.string(), name: z.string(), job_title: z.string().nullable(), department: z.string().nullable(), role: z.string() })),
  candidates: z.array(z.object({ id: z.string(), name: z.string(), department: z.string().nullable() })),
  roles: z.array(z.object({ id: z.string(), title: z.string(), department: z.string().nullable(), status: z.string() })),
}) as z.ZodType<OverviewSearchResult>;

// Batch G: persistent private policy conversation contracts. The stored
// `answer` is the full validated PolicyAnswer payload (citations, retrieval,
// computed facts, employee context) — kept opaque here; it is displayed from
// the same shape the live policy-qa call returned.
const policyMessageShape = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(["user", "assistant"]),
  question: z.string().nullable(),
  answer: z.unknown(),
  escalation_id: z.string().nullable(),
  created_at: z.string(),
});

export const policyConversationListSchema = z.object({
  ok: z.literal(true),
  conversations: z.array(
    z.object({
      id: z.string(),
      org_id: z.string(),
      owner_twin_id: z.string(),
      title: z.string(),
      created_at: z.string(),
      updated_at: z.string(),
      last_message: z.object({
        role: z.string(),
        question: z.string().nullable(),
        answer: z.unknown(),
        escalation_id: z.string().nullable(),
        created_at: z.string(),
      }).nullable(),
    })
  ),
}) as unknown as z.ZodType<{ ok: true; conversations: import("./api").PolicyConversationRow[] }>;

export const policyConversationMessagesSchema = z.object({
  ok: z.literal(true),
  conversation: z.object({ id: z.string(), title: z.string() }),
  messages: z.array(policyMessageShape),
}) as unknown as z.ZodType<{ ok: true; conversation: { id: string; title: string }; messages: import("./api").PolicyMessageRow[] }>;

export const policyConversationSaveSchema = z.object({
  ok: z.literal(true),
  conversation_id: z.string(),
  message_id: z.string(),
  created: z.boolean(),
}) as z.ZodType<{ ok: true; conversation_id: string; message_id: string; created: boolean }>;

export const policyConversationLinkSchema = z.object({
  ok: z.literal(true),
  message_id: z.string(),
  escalation_id: z.string(),
}) as z.ZodType<{ ok: true; message_id: string; escalation_id: string }>;

// Batch H (H1): honest security audit feed contract.
export const securityAuditResultSchema = z.object({
  ok: z.literal(true),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  items: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(["access", "recruitment", "recommendations", "onboarding"]),
      label: z.string(),
      detail: z.string(),
      actor: z.string().nullable(),
      reason: z.string().nullable(),
      at: z.string(),
      href: z.string().nullable(),
    })
  ),
  truncated_sources: z.array(z.string()),
}) as z.ZodType<SecurityAuditResult>;

// ---------------------------------------------------------------------------
// Batch 5: hiring work-queue contract (assessment-queue backend function).
// Strict: every queue item must carry its candidate/role linkage when the
// canonical row has one; unknown/missing linkage decodes as an explicit
// "Unknown candidate" / "—", never as a fabricated row.
// ---------------------------------------------------------------------------

const queueCandidateRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
const queueRoleRefSchema = z.object({
  requisition_id: z.string(),
  title: z.string(),
  application_code: z.string(),
  application_id: z.string(),
});
const queueSessionItemSchema = z.object({
  session_id: z.string(),
  session_type: z.enum(["work_sample", "interview", "knowledge_assessment"]),
  status: z.string(),
  expires_at: z.string(),
  submitted_at: z.string().nullable(),
  created_at: z.string(),
  blueprint_title: z.string(),
  candidate: queueCandidateRefSchema,
  role: queueRoleRefSchema,
});
const awaitingReviewItemSchema = z.object({
  assessment_id: z.string(),
  session_id: z.string().nullable(),
  session_type: z.string(),
  blueprint_title: z.string(),
  evaluated_at: z.string(),
  model: z.string(),
  review_required: z.boolean(),
  candidate: queueCandidateRefSchema,
  role: queueRoleRefSchema,
});
const failedJobItemSchema = z.object({
  job_id: z.string(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  session: queueSessionItemSchema.nullable(),
});
export const assessmentQueueSchema = z.object({
  ok: z.literal(true),
  role: z.enum(["recruiter", "hr_executive", "hr_partner"]),
  generated_at: z.string(),
  scope: z.object({ org_id: z.string() }),
  queues: z.object({
    upcoming_interviews: z.array(queueSessionItemSchema),
    invitations_awaiting_response: z.array(queueSessionItemSchema),
    incomplete_scorecards: z.array(queueSessionItemSchema),
    submitted_assessments: z.array(queueSessionItemSchema),
    awaiting_reviewer_confirmation: z.array(awaitingReviewItemSchema),
    failed_evaluation_jobs: z.array(failedJobItemSchema),
  }),
});
export type AssessmentQueueResult = z.infer<typeof assessmentQueueSchema>;
export type QueueSessionItem = z.infer<typeof queueSessionItemSchema>;
export type AwaitingReviewItem = z.infer<typeof awaitingReviewItemSchema>;
export type FailedJobItem = z.infer<typeof failedJobItemSchema>;

