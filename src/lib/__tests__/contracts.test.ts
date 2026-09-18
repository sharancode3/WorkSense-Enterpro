import { describe, expect, it } from "vitest";
import {
  decode,
  tryDecode,
  requisitionRowSchema,
  planTaskViewSchema,
  planViewSchema,
  recommendationRowSchema,
  meResultSchema,
  interviewKitSchema,
  healthViewSchema,
  staffingComparisonSchema,
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

  it("validates interview kit and staffing contracts", () => {
    const kit = {
      type: "interview_kit",
      req_id: "r1",
      req_title: "Backend",
      candidate_name: "Priya",
      score: 0.8,
      focus_items: ["Go"],
      biased_probe: null,
      competencies: [],
      created_at: "2026-09-15T09:00:00Z",
    };
    expect(decode(interviewKitSchema, kit, "kit").score).toBe(0.8);

    const staffing = {
      ok: true,
      computed_at: "2026-09-15T09:00:00Z",
      scenario: {
        req_id: "r1",
        req_title: "Backend",
        department: "Platform",
        deadline_days: 42,
        target_date_note: "",
        demand: [{ skill: "Go", target_proficiency: 4 }],
        future_skills: [],
        allocation_note: "",
      },
      options: [
        { id: "hire", label: "Hire", coverage_pct: 66, time_to_ready_days: 56, cost_usd: 10, source: "x", constraints: [], note: "" },
      ],
      planning_note: "",
    };
    const parsed = decode(staffingComparisonSchema, staffing, "staffing");
    expect(parsed.options[0].id).toBe("hire");
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
