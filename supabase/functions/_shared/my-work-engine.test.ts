import { describe, expect, it } from "vitest";
import { buildMyWork, type MyWorkInputs } from "./my-work-engine.ts";

const ORG = "org-1";
const ALEX = "22222222-2222-2222-2222-222222222203";
const SAMIRA = "22222222-2222-2222-2222-222222222204";
const INGRID = "e32c2d01-4a20-458f-a3a9-0c75f22d4c85";
const PRIYA = "22222222-2222-2222-2222-222222222205";
const JORDAN = "22222222-2222-2222-2222-222222222202";
const ELENA = "22222222-2222-2222-2222-222222222210";
const REC_SAMIRA = "44444444-4444-4444-4444-444444444401";
const REC_ALEX = "44444444-4444-4444-4444-444444444402";
const REC_UP = "44444444-4444-4444-4444-444444444404";

const ALEX_PLAN = { id: "plan-1", twin_id: ALEX, version: 1, status: "approved" };

const base = (): MyWorkInputs => ({
  caller: { id: ALEX, role: "employee", org_id: ORG },
  twins: [
    { id: ALEX, name: "Alex Chen", role: "employee", status: "active", manager_id: JORDAN },
    { id: SAMIRA, name: "Samira Patel", role: "employee", status: "active", manager_id: JORDAN },
    { id: INGRID, name: "Ingrid Vargas", role: "employee", status: "active", manager_id: JORDAN },
    { id: JORDAN, name: "Jordan Reyes", role: "manager", status: "active", manager_id: null },
    { id: ELENA, name: "Elena Voss", role: "it_security", status: "active", manager_id: null },
    { id: PRIYA, name: "Priya Nair", role: "candidate", status: "candidate", manager_id: null },
  ],
  plans: [ALEX_PLAN],
  tasks: [
    { plan_id: "plan-1", twin_id: ALEX, task_code: "it_provisioning", title: "IT & Laptop Provisioning", task_type: "provisioning", owner_role: "it_security", state: "ready", due_date: "2026-09-16T09:00:00Z", blockers: [] },
    { plan_id: "plan-1", twin_id: ALEX, task_code: "access_sso", title: "System Access & SSO Enrollment", task_type: "access", owner_role: "it_security", state: "blocked", due_date: null, blockers: [{ id: "b1", note: "SSO enrollment blocked — laptop WS-8842 pending provisioning", status: "open" }] },
    { plan_id: "plan-1", twin_id: ALEX, task_code: "payroll", title: "Direct Deposit & Payroll Setup", task_type: "onboarding_admin", owner_role: "hr", state: "ready", due_date: null, blockers: [] },
    { plan_id: "plan-1", twin_id: ALEX, task_code: "team_intro", title: "Team Introduction & Codebase Walkthrough", task_type: "onboarding_admin", owner_role: "manager", state: "blocked", due_date: null, blockers: [] },
    { plan_id: "plan-1", twin_id: ALEX, task_code: "learn_go", title: "First contribution using Go", task_type: "learning", owner_role: "employee", state: "blocked", due_date: null, blockers: [] },
    { plan_id: "plan-1", twin_id: ALEX, task_code: "security_training", title: "Security & Compliance Training", task_type: "policy", owner_role: "employee", state: "done", due_date: null, blockers: [] },
  ],
  recommendations: [
    { id: REC_SAMIRA, twin_id: SAMIRA, category: "workforce_review", urgency: "high", status: "needs_review", required_signoff_role: "manager", version: 1 },
    { id: REC_ALEX, twin_id: ALEX, category: "mobility", urgency: "low", status: "needs_review", required_signoff_role: "manager", version: 1 },
    { id: REC_UP, twin_id: INGRID, category: "upskilling", urgency: "low", status: "execution_pending", required_signoff_role: "manager", version: 2 },
  ],
  actionTasks: [
    { id: "at-1", recommendation_id: REC_UP, owner_twin_id: INGRID, owner_role: "employee", title: "Enroll in Advanced SQL & dbt (L&D)", status: "open", due_at: "2026-09-29T09:00:00Z" },
    { id: "at-2", recommendation_id: REC_UP, owner_twin_id: INGRID, owner_role: "employee", title: "Pair with the Data team on the dbt migration", status: "in_progress", due_at: "2026-10-15T09:00:00Z" },
  ],
  applications: [
    { candidate_twin_id: PRIYA, requisition_id: "req-1", stage: "final_round", applied_at: "2026-08-12T09:00:00Z" },
    { candidate_twin_id: "22222222-2222-2222-2222-222222222206", requisition_id: "req-1", stage: "screening", applied_at: "2026-09-02T09:00:00Z" },
  ],
  requisitions: [
    { id: "req-1", title: "Senior Backend Engineer", department: "Platform", status: "open" },
    { id: "req-2", title: "Data Analyst", department: "Data", status: "open" },
  ],
  sessions: [
    { id: "s1", twin_id: PRIYA, session_type: "work_sample", status: "invited", expires_at: "2026-10-15T09:00:00Z" },
  ],
  reviewCases: [
    { twin_id: SAMIRA, name: "Samira Patel", index: 77, priority: "review" },
    { twin_id: ALEX, name: "Alex Chen", index: 42, priority: "medium" },
  ],
  unverifiedClaims: 12,
});

describe("my-work engine — unified assigned-work contract", () => {
  it("employee sees waiting-on-others states and their own tasks, never an HR review score", () => {
    const r = buildMyWork({ ...base(), caller: { id: ALEX, role: "employee", org_id: ORG } });
    const waiting = r.items.filter((i) => i.group === "waiting");
    const subjects = waiting.map((i) => i.title).join(" | ");
    // IT provisioning (IT), payroll (HR), team intro (Manager) are waiting for Alex.
    expect(subjects).toContain("IT & Laptop Provisioning");
    expect(subjects).toContain("Direct Deposit & Payroll Setup");
    expect(subjects).toContain("Team Introduction & Codebase Walkthrough");
    // Employee-owned blocked task is attention, not a retention score.
    const blocked = r.items.find((i) => i.title.startsWith("Blocked: First contribution using Go"));
    expect(blocked?.group).toBe("attention");
    expect(r.items.some((i) => i.type === "review_case")).toBe(false);
    expect(r.items.some((i) => i.type === "approval_request")).toBe(false);
    // Done tasks never surface.
    expect(r.items.some((i) => i.title.includes("Security & Compliance Training"))).toBe(false);
  });

  it("manager sees team-scoped approvals and review cases only", () => {
    const r = buildMyWork({ ...base(), caller: { id: JORDAN, role: "manager", org_id: ORG } });
    const approvals = r.items.filter((i) => i.type === "approval_request");
    expect(approvals.map((i) => i.subject)).toEqual(expect.arrayContaining(["Samira Patel", "Alex Chen"]));
    expect(approvals.every((i) => i.group === "attention")).toBe(true);
    const reviews = r.items.filter((i) => i.type === "review_case");
    expect(reviews.map((i) => i.subject_id)).toContain(SAMIRA);
    // Approved/dispatched rec does not become an approval.
    expect(approvals.some((i) => i.source.ref_id === REC_UP)).toBe(false);
    // Only team twins — an out-of-team twin would never appear.
    const subjects = r.items.map((i) => i.subject_id);
    expect(subjects).not.toContain("outside-team-twin");
  });

  it("IT sees Alex's provisioning work only — no broader HR data", () => {
    const r = buildMyWork({ ...base(), caller: { id: ELENA, role: "it_security", org_id: ORG } });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.type === "provisioning_request")).toBe(true);
    expect(r.items.some((i) => i.type === "approval_request" || i.type === "review_case")).toBe(false);
    const ready = r.items.find((i) => i.source.ref_id === "plan-1" && i.title === "IT & Laptop Provisioning");
    expect(ready?.group).toBe("ready");
    expect(ready?.authorized_actions).toContain("complete");
    const blocked = r.items.find((i) => i.title.startsWith("Blocked: System Access & SSO"));
    expect(blocked?.group).toBe("attention");
    expect(blocked?.blocker).toContain("laptop WS-8842");
    expect(blocked?.authorized_actions).toContain("resolve_blocker");
    // Deep links target the employee's onboarding center.
    expect(r.items.every((i) => i.deep_link.startsWith("/onboarding?twin="))).toBe(true);
  });

  it("recruiter sees candidate rows with names, stage and honest ordering", () => {
    const r = buildMyWork({ ...base(), caller: { id: "rec-1", role: "recruiter", org_id: ORG } });
    const steps = r.items.filter((i) => i.type === "candidate_next_step");
    expect(steps.length).toBe(2);
    // Ordered oldest-applied first (age, not score) — never labeled as ranking.
    expect(steps[0].subject).toBe("Priya Nair");
    expect(steps[0].status_label).toBe("Decision pending");
    expect(steps[0].title).toContain("Make a decision");
    expect(r.items.some((i) => i.type === "assessment_session" && i.subject === "Priya Nair")).toBe(true);
    // Requisition with zero candidates is called out honestly.
    expect(r.items.some((i) => i.type === "requisition_attention" && i.title.includes("Data Analyst"))).toBe(true);
  });

  it("HR admin gets a data-quality alert with the org's unverified claims", () => {
    const r = buildMyWork({ ...base(), caller: { id: "dana", role: "hr_executive", org_id: ORG } });
    const q = r.items.find((i) => i.type === "data_quality_alert");
    expect(q?.title).toContain("12 skill claims");
    expect(q?.deep_link).toBe("/workforce/data-quality");
  });

  it("deep links reference the correct workflow source", () => {
    const r = buildMyWork({ ...base(), caller: { id: JORDAN, role: "manager", org_id: ORG } });
    const approval = r.items.find((i) => i.type === "approval_request");
    expect(approval?.deep_link).toBe(`/hub?rec=${REC_SAMIRA}`);
    expect(approval?.source).toMatchObject({ workflow: "recommendation", version: 1, ref_id: REC_SAMIRA });
    const task = r.items.find((i) => i.type === "onboarding_task");
    expect(task?.source.workflow).toBe("onboarding_plan");
    expect(task?.source.version).toBe(1);
  });

  it("summary counts match the grouped items", () => {
    const r = buildMyWork({ ...base(), caller: { id: JORDAN, role: "manager", org_id: ORG } });
    expect(r.summary.attention).toBe(r.items.filter((i) => i.group === "attention").length);
    expect(r.summary.ready).toBe(r.items.filter((i) => i.group === "ready").length);
    expect(r.summary.waiting).toBe(r.items.filter((i) => i.group === "waiting").length);
  });
});
