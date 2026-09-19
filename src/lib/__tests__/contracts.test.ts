import { describe, expect, it } from "vitest";
import {
  decode,
  tryDecode,
  requisitionRowSchema,
  candidateCompareSchema,
  planViewSchema,
  planTaskViewSchema,
  onboardingQueueSchema,
  recommendationRowSchema,
  meResultSchema,
  interviewKitSchema,
  healthViewSchema,
  staffingPlannerResultSchema,
  overviewSearchResultSchema,
  policyConversationListSchema,
  policyConversationMessagesSchema,
  policyConversationSaveSchema,
  policyConversationLinkSchema,
  securityAuditResultSchema,
} from "../contracts";

describe("decode (unknown -> validated schema -> typed contract)", () => {
  it("accepts a well-formed requisition row", () => {
    const row = {
      id: "r1",
      title: "Backend Engineer",
      department: "Platform",
      status: "open",
      seniority_level: 3,
      required_skills: [{ skill: "Go", target_proficiency: 4 }],
      future_skills: [],
      applicants: [{ twin_id: "t1", stage: "screening", match_score: 0.5 }],
    };
    const parsed = decode(requisitionRowSchema, row, "req-row");
    expect(parsed.id).toBe("r1");
    expect(parsed.applicants[0].match_score).toBe(0.5);
  });

  it("defaults requisition criteria to [] when absent (legacy rows still decode)", () => {
    const legacy = {
      id: "r2",
      title: "Data Analyst",
      department: "Data",
      status: "open",
      seniority_level: 3,
      required_skills: [{ skill: "SQL", target_proficiency: 4 }],
      future_skills: [],
      applicants: [],
    };
    expect(decode(requisitionRowSchema, legacy, "legacy-req").requisition_criteria).toEqual([]);
  });

  it("decodes weighted criteria on a requisition row", () => {
    const row = {
      id: "r3",
      title: "DevOps Engineer",
      department: "Platform",
      status: "open",
      seniority_level: 3,
      required_skills: [{ skill: "Kubernetes", target_proficiency: 3 }],
      future_skills: [],
      applicants: [],
      requisition_criteria: [
        { skill: "Kubernetes", target_proficiency: 3, requirement: "required", weight: 0.6, evidence_expectation: "K8s cluster artifact." },
        { skill: "AWS", target_proficiency: 2, requirement: "preferred", weight: 0.4, evidence_expectation: "Cloud cert in progress." },
      ],
    };
    const parsed = decode(requisitionRowSchema, row, "criteria-req");
    expect(parsed.requisition_criteria).toHaveLength(2);
    expect(parsed.requisition_criteria[0].requirement).toBe("required");
  });

  it("rejects a criterion with an out-of-range weight", () => {
    const bad = {
      id: "r4",
      title: "X",
      department: "Y",
      status: "open",
      seniority_level: 3,
      required_skills: [],
      future_skills: [],
      applicants: [],
      requisition_criteria: [{ skill: "Go", target_proficiency: 3, requirement: "required", weight: 7, evidence_expectation: "e" }],
    };
    expect(tryDecode(requisitionRowSchema, bad, "bad-criteria")).toBeNull();
  });

  it("decodes a candidate comparison payload", () => {
    const payload = {
      ok: true as const,
      req_id: "r1",
      req_title: "Backend Engineer",
      criteria: [{ skill: "Go", target_proficiency: 4, requirement: "required", weight: 1, evidence_expectation: "Go work sample." }],
      rows: [
        { twin_id: "t1", name: "Aria", email: "aria@example.com", stage: "final_round", version: 2, application_code: "WS-1", applied_at: "2026-08-12T09:00:00Z", status: "scored", score: 0.83, score_at: "2026-08-20T09:00:00Z", gaps: [], adjacent: [], transferable: [], gate_met: true, mandatory_readiness: 0.8, preferred_readiness: 0.6, verified_coverage: { met: 3, total: 4 }, provisional_coverage: { met: 4, total: 4 }, evidence_confidence: 0.9, work_sample: 0.8, work_sample_reviewed: true, interview_score: 0.85, interview_status: "scored", assessment_submitted: true, rank: 0.81, rank_components: { mandatory: 0.8, preferred: 0.6, work_sample: 0.8, interview: 0.85, confidence: 0.9 }, rank_tier: "ranked", tie_reason: null },
        { twin_id: "t2", name: "Bo", email: null, stage: "screening", version: 1, application_code: "WS-2", applied_at: "2026-09-01T09:00:00Z", status: "unscored", score: null, score_at: null, gaps: [], adjacent: [], transferable: [], gate_met: null, mandatory_readiness: null, preferred_readiness: null, verified_coverage: { met: 0, total: 0 }, provisional_coverage: { met: 0, total: 0 }, evidence_confidence: null, work_sample: null, work_sample_reviewed: false, interview_score: null, interview_status: "none", assessment_submitted: false, rank: null, rank_components: { mandatory: null, preferred: null, work_sample: null, interview: null, confidence: null }, rank_tier: "unranked", tie_reason: null },
      ],
      scored_count: 1,
      unscored_count: 1,
      stale_count: 0,
      rank_weights: { mandatory: 0.35, preferred: 0.2, work_sample: 0.2, interview: 0.15, confidence: 0.1 },
      fairness: { excluded_attributes: [], statement: "" },
    };
    const parsed = decode(candidateCompareSchema, payload, "candidate-compare");
    expect(parsed.rows[0].status).toBe("scored");
    expect(parsed.rows[1].score).toBeNull();
    expect(parsed.unscored_count).toBe(1);
  });

  it("rejects a requisition row missing its id (required contract surface)", () => {
    const bad = { title: "Missing id" };
    expect(() => decode(requisitionRowSchema, bad, "req-row")).toThrow(/contract check failed/);
  });

  it("rejects a requisition row with a malformed applicant", () => {
    const bad = {
      id: "r1",
      title: "T",
      department: "D",
      status: "open",
      seniority_level: 3,
      required_skills: [],
      future_skills: [],
      applicants: [{ stage: "screening" }], // missing twin_id
    };
    expect(() => decode(requisitionRowSchema, bad, "req-row")).toThrow(/contract check failed/);
  });

  it("accepts a seeded onboarding task row and derives blocked_reasons", () => {
    const row = {
      id: "x",
      plan_id: "p1",
      task_code: "it_provisioning",
      title: "IT & Laptop Provisioning",
      task_type: "provisioning",
      owner_role: "it_security",
      required: true,
      non_waivable: true,
      depends_on: [],
      duration_days: 1,
      due_date: "2026-09-16T09:00:00Z",
      topological_level: 0,
      why_evidence: { reason: "mandatory", source_evidence: [{ source_type: "policy", fact: "POL-SEC" }] },
      evidence_requirements: [{ kind: "note", label: "Hardware & asset tag", required: true }],
      state: "ready",
      blocked_reasons: [],
      blockers: [],
      waiver: null,
      completion_record: null,
      adaptation: null,
    };
    const parsed = decode(planTaskViewSchema, row, "plan-task-row");
    expect(parsed.owner_role).toBe("it_security");
  });

  it("rejects a task row with an invalid state enum", () => {
    const row = {
      task_code: "x",
      title: "t",
      task_type: "provisioning",
      owner_role: "employee",
      required: true,
      non_waivable: false,
      depends_on: [],
      duration_days: 1,
      due_date: null,
      topological_level: 0,
      why_evidence: { reason: "", source_evidence: [] },
      evidence_requirements: [],
      state: "nonsense",
      blocked_reasons: [],
      blockers: [],
      waiver: null,
      completion_record: null,
      adaptation: null,
    };
    expect(() => decode(planTaskViewSchema, row, "plan-task-row")).toThrow(/state/);
  });

  it("validates the wire health contract and rejects overclaiming ok", () => {
    const ok = { ok: true, app_backend: "ok", gateway: "unreachable", model_ready: false, gateway_authenticated: false, model: "qwen3" };
    expect(decode(healthViewSchema, ok, "health").gateway).toBe("unreachable");
    const lying = { ok: "true", app_backend: "ok" };
    expect(() => decode(healthViewSchema, lying, "health")).toThrow(/contract check failed/);
  });

  it("validates the constrained staffing planner result contract", () => {
    const staffing = {
      ok: true,
      scenario_id: "s1",
      scope: "org",
      options: [
        { id: "hire", label: "Hire externally", status: "infeasible", ready_at_days: 56, cost_usd: 45000, verified_coverage_pct: 100, mandatory_satisfied: true },
        { id: "upskill", label: "Upskill internally", status: "conditional", ready_at_days: 28, cost_usd: 1200, verified_coverage_pct: 50, mandatory_satisfied: true },
      ],
      decision_table: [
        { option_id: "hire", status: "infeasible" },
        { option_id: "upskill", status: "conditional" },
      ],
      note: "deterministic",
    };
    const parsed = decode(staffingPlannerResultSchema, staffing, "staffing");
    expect(parsed.options[0].id).toBe("hire");
    expect(parsed.options[0].status).toBe("infeasible");
  });

  it("validates the authorized overview search result contract", () => {
    const res = {
      ok: true,
      q: "back",
      scope: "org",
      people: [{ id: "p1", name: "Alex Chen", job_title: "Engineer", department: "Platform", role: "employee" }],
      candidates: [{ id: "c1", name: "Sofia Reyes", department: "Platform" }],
      roles: [{ id: "r1", title: "Senior Backend Engineer", department: "Platform", status: "open" }],
    };
    expect(decode(overviewSearchResultSchema, res, "overview-search").roles[0].title).toBe("Senior Backend Engineer");
    const short = { ...res, scope: "team" };
    expect(decode(overviewSearchResultSchema, short, "overview-search").scope).toBe("team");
    expect(() => decode(overviewSearchResultSchema, { ...res, q: 42 }, "overview-search")).toThrow(/contract check failed/);
  });

  it("validates the private policy conversation contracts", () => {
    const list = {
      ok: true,
      conversations: [
        {
          id: "c1",
          org_id: "o1",
          owner_twin_id: "t1",
          title: "How much leave?",
          created_at: "2026-09-18T00:00:00Z",
          updated_at: "2026-09-18T00:00:00Z",
          last_message: { role: "assistant", question: null, answer: { status: "grounded" }, escalation_id: null, created_at: "2026-09-18T00:00:00Z" },
        },
        {
          id: "c2",
          org_id: "o1",
          owner_twin_id: "t1",
          title: "Remote work",
          created_at: "2026-09-17T00:00:00Z",
          updated_at: "2026-09-17T00:00:00Z",
          last_message: null,
        },
      ],
    };
    expect(decode(policyConversationListSchema, list, "pc.list").conversations).toHaveLength(2);
    const msgs = {
      ok: true,
      conversation: { id: "c1", title: "How much leave?" },
      messages: [
        { id: "m1", conversation_id: "c1", role: "user", question: "How much leave?", answer: null, escalation_id: null, created_at: "2026-09-18T00:00:00Z" },
        { id: "m2", conversation_id: "c1", role: "assistant", question: null, answer: { status: "grounded", citations: [] }, escalation_id: "e1", created_at: "2026-09-18T00:00:01Z" },
      ],
    };
    const parsed = decode(policyConversationMessagesSchema, msgs, "pc.messages");
    expect(parsed.messages[1].escalation_id).toBe("e1");
    expect(decode(policyConversationSaveSchema, { ok: true, conversation_id: "c1", message_id: "m2", created: true }, "pc.save").created).toBe(true);
    expect(decode(policyConversationLinkSchema, { ok: true, message_id: "m2", escalation_id: "e1" }, "pc.link").escalation_id).toBe("e1");
  });

  it("validates the security audit feed contract", () => {
    const feed = {
      ok: true,
      total: 3,
      page: 1,
      page_size: 20,
      items: [
        { key: "adm:1", kind: "access", label: "ACCOUNT_SUSPENDED", detail: "Emp · active → suspended", actor: "Dana Whitmore", reason: "review", at: "2026-09-18T00:00:00Z", href: "/admin/access" },
        { key: "wfe:1", kind: "recommendations", label: "RECOMMENDATION_APPROVED", detail: "Upskilling · needs_review → approved", actor: "Jordan Reyes", reason: null, at: "2026-09-17T00:00:00Z", href: "/hub?rec=44444444-4444-4444-4444-444444444404" },
      ],
      truncated_sources: [],
    };
    const parsed = decode(securityAuditResultSchema, feed, "security-audit");
    expect(parsed.total).toBe(3);
    expect(parsed.items[1].kind).toBe("recommendations");
    expect(parsed.items[1].href).toContain("/hub?rec=");
    expect(() => decode(securityAuditResultSchema, { ...feed, items: [{ key: "x", kind: "bogus" }] }, "security-audit")).toThrow(/contract check failed/);
  });

  it("validates the me contract used at app bootstrap", () => {
    const me = {
      ok: true,
      user: { id: "u1", email: "a@b.c" },
      twin: {
        id: "t1",
        org_id: "o1",
        auth_user_id: "u1",
        role: "manager",
        status: "active",
        name: "Jordan",
        email: "j@worksense.demo",
        department: "Platform",
        job_title: "Manager",
        manager_id: null,
        tenure_months: 40,
        verified_skills: [],
        interview_rubrics: [],
        performance_history: [],
        signals: [],
        computed_fits: [],
        audit_events: [],
      },
    };
    expect(decode(meResultSchema, me, "me").twin.role).toBe("manager");
  });

  it("validates plan + recommendation rows against their contracts", () => {
    const plan = {
      id: "p1",
      twin_id: "t1",
      application_id: "a1",
      version: 1,
      plan_hash: "h",
      status: "approved",
      manager_approval: { by: "j", by_twin_id: "t2", at: "2026-09-15T09:00:00Z" },
      hr_approval: null,
      start_date: "2026-07-21T09:00:00Z",
      generated_at: "2026-09-15T09:00:00Z",
      readiness: { ready_pct: 8.3, satisfied: 1, total: 12, remaining_critical_days: 4.5, projected_ready_date: "2026-09-19T21:00:00Z", blocked_count: 9, note: "" },
      carryover: [],
      audit_events: [{ actor: "system", action: "plan_generated", timestamp: "2026-09-15T09:00:00Z" }],
    };
    expect(decode(planViewSchema, plan, "plan").status).toBe("approved");

    const rec = {
      id: "rec1",
      twin_id: "t1",
      category: "workforce_review",
      urgency: "high",
      status: "needs_review",
      version: 1,
      source_hash: null,
      resource_ref: null,
      alternatives: [],
      required_approvers: [],
      expires_at: null,
      stale: false,
      stale_reason: null,
      superseded_by: null,
      intended_outcome: {},
      outcomes: {},
      evidence_ledger: [],
      proposed_action: { title: "Manager review", description: "d", steps: [] },
      executive_summary: "s",
      required_signoff_role: "manager",
      reviewer_rationale: {},
      audit_events: [{ actor: "system", action: "created", timestamp: "2026-09-15T09:00:00Z" }],
      approved_at: null,
      created_at: "2026-09-15T09:00:00Z",
    };
    expect(decode(recommendationRowSchema, rec, "rec").status).toBe("needs_review");
  });

  it("tryDecode returns null instead of throwing for non-matching payloads", () => {
    expect(tryDecode(healthViewSchema, { nope: true }, "health")).toBeNull();
  });
});

describe("Phase 6 onboarding contracts", () => {
  it("decodes extended readiness (dimensions, critical path, provisional, business days)", () => {
    const plan = {
      id: "p1",
      twin_id: "t1",
      application_id: null,
      version: 2,
      plan_hash: "abc123",
      status: "approved",
      manager_approval: null,
      hr_approval: null,
      start_date: "2026-09-01T09:00:00Z",
      generated_at: "2026-09-01T09:00:00Z",
      readiness: {
        ready_pct: 40,
        satisfied: 2,
        total: 5,
        remaining_critical_days: 3,
        projected_ready_date: null,
        blocked_count: 1,
        note: "provisional",
        provisional: true,
        critical_path: ["access_sso", "team_intro", "learn_go"],
        dimensions: [
          { key: "access", label: "Access readiness", satisfied: 0, total: 2, pct: 0, note: "n" },
          { key: "compliance", label: "Compliance readiness", satisfied: 1, total: 1, pct: 100, note: "n" },
          { key: "capability", label: "Role capability", satisfied: 0, total: 2, pct: 0, note: "n" },
        ],
        working_calendar: "business_days",
      },
      carryover: [],
      audit_events: [],
    };
    const parsed = decode(planViewSchema, plan, "plan");
    expect(parsed.readiness.provisional).toBe(true);
    expect(parsed.readiness.critical_path).toContain("learn_go");
    expect(parsed.readiness.dimensions.map((d) => d.key)).toEqual(["access", "compliance", "capability"]);
    expect(parsed.readiness.working_calendar).toBe("business_days");
  });

  it("defaults new readiness fields on legacy plans (safe decode)", () => {
    const legacy = {
      id: "p2",
      twin_id: "t1",
      application_id: null,
      version: 1,
      plan_hash: "h",
      status: "approved",
      manager_approval: null,
      hr_approval: null,
      start_date: "2026-09-01T09:00:00Z",
      generated_at: "2026-09-01T09:00:00Z",
      readiness: { ready_pct: 50, satisfied: 1, total: 2, remaining_critical_days: 1, projected_ready_date: null, blocked_count: 0, note: "n" },
      carryover: [],
      audit_events: [],
    };
    const parsed = decode(planViewSchema, legacy, "legacy-plan");
    expect(parsed.readiness.provisional).toBe(false);
    expect(parsed.readiness.critical_path).toEqual([]);
    expect(parsed.readiness.dimensions).toEqual([]);
  });

  it("decodes a task blocker with resolution owner", () => {
    const task = {
      task_code: "access_sso",
      title: "System Access",
      task_type: "access",
      owner_role: "it_security",
      required: true,
      non_waivable: true,
      depends_on: [],
      duration_days: 0.5,
      due_date: "2026-09-15T09:00:00Z",
      topological_level: 1,
      why_evidence: { reason: "r", source_evidence: [] },
      evidence_requirements: [],
      state: "ready",
      blocked_reasons: [],
      blockers: [{ id: "b1", note: "n", reported_by: "elena", at: "2026-09-12T09:00:00Z", status: "resolved", resolved_by: "elena", resolved_at: "2026-09-14T09:00:00Z" }],
      waiver: null,
      completion_record: null,
      adaptation: null,
    };
    const parsed = decode(planTaskViewSchema, task, "task");
    expect(parsed.blockers[0].resolved_by).toBe("elena");
  });

  it("decodes an onboarding queue payload", () => {
    const payload = {
      ok: true as const,
      role: "hr" as const,
      journeys: [
        {
          twin_id: "t1",
          employee_name: "Alex Chen",
          job_title: "Engineer",
          department: "Platform",
          manager_id: "m1",
          plan_id: "p1",
          version: 2,
          status: "approved",
          start_date: "2026-09-01T09:00:00Z",
          readiness_pct: 40,
          projected_ready_date: null,
          provisional: true,
          blocked_count: 1,
          completed_tasks: 3,
          total_tasks: 8,
          gates: [{ key: "access", label: "System access", pct: 50 }],
          pending_manager_approval: false,
          pending_hr_approval: false,
          overdue: true,
          overdue_count: 1,
          stalled: true,
          stall_reasons: ["1 open blocker(s)"],
          viewer_actions: [],
          waiting_on: [{ task_code: "team_intro", title: "Team Introduction", task_type: "onboarding_admin", owner_role: "manager", state: "pending", due_date: null, topological_level: 2, plan_id: "p1", twin_id: "t1" }],
        },
      ],
      provisioning: [],
      filters: { all: 1, pending_approval: 0, overdue: 1, stalled: 1 },
    };
    const parsed = decode(onboardingQueueSchema, payload, "queue");
    expect(parsed.journeys[0].stalled).toBe(true);
    expect(parsed.journeys[0].waiting_on[0].title).toBe("Team Introduction");
    expect(parsed.filters.stalled).toBe(1);
  });
});
