import { describe, expect, it } from "vitest";
import {
  notifBuildDigest,
  notifDateKey,
  notifDedupKey,
  notifFilterByPrefs,
  notifRules,
  notifWorkflowAnalytics,
  type NotifInputs,
  type NotifPrefsRow,
} from "./notification-engine.ts";

const NOW = "2026-09-19T10:00:00.000Z";
const TODAY = "2026-09-19";

const DANA = "22222222-2222-2222-2222-222222222201"; // hr_executive
const RILEY = "22222222-2222-2222-2222-222222222208"; // hr_partner
const JORDAN = "22222222-2222-2222-2222-222222222202"; // manager
const CHRIS = "22222222-2222-2222-2222-222222222209"; // recruiter
const ALEX = "22222222-2222-2222-2222-222222222203"; // employee
const ELENA = "22222222-2222-2222-2222-222222222210"; // it_security
const CANDIDATE = "22222222-2222-2222-2222-222222222205";

function baseInputs(overrides: Partial<NotifInputs> = {}): NotifInputs {
  return {
    org_id: "org-1",
    twins: [
      { id: DANA, name: "Dana Whitmore", role: "hr_executive", status: "active", manager_id: null },
      { id: RILEY, name: "Riley Morgan", role: "hr_partner", status: "active", manager_id: DANA },
      { id: JORDAN, name: "Jordan Reyes", role: "manager", status: "active", manager_id: null },
      { id: CHRIS, name: "Chris Okafor", role: "recruiter", status: "active", manager_id: null },
      { id: ALEX, name: "Alex Chen", role: "employee", status: "active", manager_id: JORDAN },
      { id: ELENA, name: "Elena Voss", role: "it_security", status: "active", manager_id: DANA },
      { id: CANDIDATE, name: "Priya Singh", role: "candidate", status: "active", manager_id: null },
    ],
    plans: [],
    tasks: [],
    applications: [],
    requisitions: [],
    sessions: [],
    assessments: [],
    recommendations: [],
    actionTasks: [],
    reviewCases: [],
    reviewActions: [],
    staffingProposals: [],
    policyDocs: [],
    escalations: [],
    assertions: [],
    adminActions: [],
    personalTasks: [],
    instances: [],
    prefs: [],
    ...overrides,
  };
}

const PREFS: NotifPrefsRow = {
  twin_id: ALEX,
  in_app: true,
  assignments: true,
  due_soon: true,
  overdue: true,
  status_updates: true,
  personal_reminders: true,
  daily_digest: true,
  weekly_digest: true,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "08:00",
  timezone: "UTC",
  working_days: [1, 2, 3, 4, 5],
};

describe("notification rules", () => {
  it("routes an assessment submission to the recruiter only, with the My Day work-item id", () => {
    const inputs = baseInputs({
      sessions: [{ id: "s1", twin_id: CANDIDATE, session_type: "work_sample", status: "submitted", expires_at: null }],
      applications: [{ candidate_twin_id: CANDIDATE, requisition_id: "req1", stage: "technical_interview", applied_at: NOW, version: 3 }],
      requisitions: [{ id: "req1", title: "Backend Engineer", department: "Platform", status: "open" }],
    });
    const drafts = notifRules(inputs, NOW, TODAY);
    const mine = drafts.filter((d) => d.type === "assessment_awaiting_review");
    expect(mine).toHaveLength(1);
    expect(mine[0].recipient_twin_id).toBe(CHRIS);
    expect(mine[0].action_required).toBe(true);
    expect(mine[0].action_label).toBe("Review assessment");
    expect(mine[0].work_item_id).toBe("session:s1");
    expect(mine[0].related_name).toBe("Priya Singh");
    // No candidate sees internal notifications.
    expect(drafts.some((d) => d.recipient_twin_id === CANDIDATE)).toBe(false);
  });

  it("routes a pending onboarding plan to HR with an approve action", () => {
    const inputs = baseInputs({
      plans: [{ id: "plan1", twin_id: ALEX, version: 2, status: "pending_approval", start_date: null }],
    });
    const drafts = notifRules(inputs, NOW, TODAY);
    const mine = drafts.filter((d) => d.type === "plan_awaiting_approval");
    expect(mine.map((d) => d.recipient_twin_id).sort()).toEqual([DANA, RILEY].sort());
    expect(mine[0].action_label).toBe("Approve plan");
    expect(mine[0].deep_link).toBe(`/onboarding?twin=${ALEX}`);
  });

  it("routes provisioning work to IT with the provisioning work-item id", () => {
    const inputs = baseInputs({
      tasks: [{ plan_id: "plan1", twin_id: ALEX, task_code: "access_sso", title: "Access SSO", task_type: "access", owner_role: "it_security", state: "ready", due_date: NOW, completion_at: null }],
    });
    const drafts = notifRules(inputs, NOW, TODAY);
    const mine = drafts.filter((d) => d.type === "provisioning_required");
    expect(mine).toHaveLength(1);
    expect(mine[0].recipient_twin_id).toBe(ELENA);
    expect(mine[0].work_item_id).toBe("provisioning:plan1:access_sso");
  });

  it("reports onboarding blockers to the owner and watches for the manager", () => {
    const inputs = baseInputs({
      tasks: [{
        plan_id: "plan1", twin_id: ALEX, task_code: "access_sso", title: "Access SSO", task_type: "access", owner_role: "it_security", state: "blocked", due_date: null, completion_at: null,
        blockers: [{ id: "b1", note: "laptop not provisioned", status: "open", reported_by: "it", at: NOW }],
      }],
    });
    const drafts = notifRules(inputs, NOW, TODAY);
    const owner = drafts.filter((d) => d.type === "onboarding_blocked");
    expect(owner.map((d) => d.recipient_twin_id)).toContain(ELENA);
    const watch = drafts.filter((d) => d.type === "onboarding_blocker_watch");
    expect(watch.map((d) => d.recipient_twin_id)).toContain(JORDAN);
  });

  it("creates review-case notifications only for high-priority cases", () => {
    const inputs = baseInputs({
      reviewCases: [
        { twin_id: ALEX, name: "Alex Chen", index: 82, priority: "review" },
        { twin_id: CANDIDATE, name: "Priya Singh", index: 20, priority: "low" },
      ],
    });
    const drafts = notifRules(inputs, NOW, TODAY);
    const mine = drafts.filter((d) => d.type === "review_case_assigned");
    // High-priority Alex case: his manager + both HR twins = 3; low-priority candidate case excluded.
    expect(mine).toHaveLength(3);
    expect(mine.map((d) => d.recipient_twin_id)).toContain(JORDAN);
    expect(mine.every((d) => d.related_twin_id === ALEX)).toBe(true);
  });

  it("personal tasks remind their owner, never anyone else", () => {
    const inputs = baseInputs({
      personalTasks: [
        { id: "p1", owner_twin_id: ALEX, title: "Submit expense report", due_at: `${TODAY}T09:00:00.000Z`, status: "todo", recurrence: null, original_due_at: null, rollover_count: 0 },
        { id: "p2", owner_twin_id: JORDAN, title: "1:1 prep", due_at: `${TODAY}T09:00:00.000Z`, status: "todo", recurrence: null, original_due_at: null, rollover_count: 0 },
      ],
    });
    const drafts = notifRules(inputs, NOW, TODAY);
    const reminders = drafts.filter((d) => d.type === "personal_task_due");
    expect(reminders.map((d) => d.recipient_twin_id).sort()).toEqual([ALEX, JORDAN].sort());
    expect(reminders.find((d) => d.title.includes("expense"))?.recipient_twin_id).toBe(ALEX);
  });

  it("deduplication keys are stable for the same event and version, and differ when the version changes", () => {
    const a = notifDedupKey(["recommendation_review", "recommendation", "rec1", "1", ALEX, "1"]);
    const b = notifDedupKey(["recommendation_review", "recommendation", "rec1", "1", ALEX, "1"]);
    const c = notifDedupKey(["recommendation_review", "recommendation", "rec1", "2", ALEX, "1"]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBe(8);
  });

  it("quiet hours suppress normal reminders but not critical incidents", () => {
    const inputs = baseInputs({
      personalTasks: [{ id: "p1", owner_twin_id: ALEX, title: "Routine", due_at: `${TODAY}T09:00:00.000Z`, status: "todo", recurrence: null, original_due_at: null, rollover_count: 0 }],
      tasks: [{ plan_id: "plan1", twin_id: ALEX, task_code: "policy_signing", title: "Policy signing", task_type: "policy", owner_role: "employee", state: "pending", due_date: "2026-09-17T09:00:00.000Z", completion_at: null }],
    });
    const drafts = notifRules(inputs, NOW, TODAY);
    const quiet: NotifPrefsRow = { ...PREFS, quiet_hours_enabled: true, quiet_hours_start: "08:00", quiet_hours_end: "12:00" };
    const filtered = notifFilterByPrefs(drafts, [quiet], NOW, 0);
    // Personal reminder (normal) is suppressed; overdue task reminder (critical) survives.
    expect(filtered.some((d) => d.type === "personal_task_due")).toBe(false);
    expect(filtered.some((d) => d.type === "task_overdue")).toBe(true);
  });

  it("respects per-channel preference toggles", () => {
    const inputs = baseInputs({
      personalTasks: [{ id: "p1", owner_twin_id: ALEX, title: "Routine", due_at: `${TODAY}T09:00:00.000Z`, status: "todo", recurrence: null, original_due_at: null, rollover_count: 0 }],
    });
    const drafts = notifRules(inputs, NOW, TODAY);
    const off = notifFilterByPrefs(drafts, [{ ...PREFS, personal_reminders: false }], NOW, 0);
    expect(off.some((d) => d.type === "personal_task_due")).toBe(false);
  });
});

describe("digest", () => {
  it("produces deterministic facts that match canonical rows", () => {
    const inputs = baseInputs({
      plans: [{ id: "plan1", twin_id: ALEX, version: 1, status: "pending_approval", start_date: null }],
      recommendations: [{ id: "rec1", twin_id: ALEX, category: "upskilling", urgency: "medium", status: "needs_review", version: 1, required_signoff_role: "manager" }],
      sessions: [{ id: "s1", twin_id: CANDIDATE, session_type: "work_sample", status: "submitted", expires_at: null }],
      instances: [{ id: "i1", owner_twin_id: ALEX, rule_key: "system:skills:refresh", occurrence_date: TODAY, due_at: `${TODAY}T10:00:00.000Z`, title: "Refresh skills", status: "todo" }],
    });
    const digest = notifBuildDigest(inputs, [], "employee", "daily", NOW, TODAY, 0);
    expect(digest.facts.join(" ")).toContain("1 onboarding plan awaits approval");
    expect(digest.facts.join(" ")).toContain("1 recommendation awaits sign-off");
    expect(digest.facts.join(" ")).toContain("1 assessment awaits review");
    expect(digest.facts.join(" ")).toContain("1 personal routine due today");
    expect(digest.period_key).toBe(TODAY);
  });
});

describe("workflow analytics", () => {
  it("excludes waiting/blocked from the on-time denominator and reports them separately", () => {
    const inputs = baseInputs({
      tasks: [
        { plan_id: "plan1", twin_id: ALEX, task_code: "t1", title: "Done on time", task_type: "learning", owner_role: "employee", state: "done", due_date: "2026-09-18T09:00:00.000Z", completion_at: "2026-09-18T08:00:00.000Z" },
        { plan_id: "plan1", twin_id: ALEX, task_code: "t2", title: "Blocked", task_type: "access", owner_role: "employee", state: "blocked", due_date: "2026-09-17T09:00:00.000Z", completion_at: null, blockers: [{ status: "open", note: "x" }] },
        { plan_id: "plan1", twin_id: ALEX, task_code: "t3", title: "Waiting", task_type: "onboarding_admin", owner_role: "hr", state: "pending", due_date: "2026-09-16T09:00:00.000Z", completion_at: null },
      ],
      plans: [{ id: "plan1", twin_id: ALEX, version: 1, status: "approved", start_date: "2026-09-15T09:00:00.000Z" }],
    });
    const a = notifWorkflowAnalytics(inputs, new Set([ALEX]), "employee", NOW, TODAY, 0);
    expect(a.completed_count).toBe(1);
    expect(a.on_time).toBe(1);
    expect(a.on_time_rate).toBe(100);
    expect(a.blocked_now).toBe(1);
    expect(a.notes.some((n) => n.includes("Blocked/waiting items are excluded"))).toBe(true);
    expect(a.notes.some((n) => n.includes("do not measure employee value"))).toBe(true);
  });

  it("computes median cycle time from completion timestamps", () => {
    const inputs = baseInputs({
      actionTasks: [
        { id: "a1", recommendation_id: "r1", owner_twin_id: ALEX, owner_role: "employee", title: "Course", status: "completed", due_at: "2026-09-20T09:00:00.000Z", task_code: "c1", started_at: "2026-09-17T09:00:00.000Z", completed_at: "2026-09-18T09:00:00.000Z" },
        { id: "a2", recommendation_id: "r1", owner_twin_id: ALEX, owner_role: "employee", title: "Pairing", status: "completed", due_at: "2026-09-20T09:00:00.000Z", task_code: "c2", started_at: "2026-09-17T09:00:00.000Z", completed_at: "2026-09-19T09:00:00.000Z" },
      ],
    });
    const a = notifWorkflowAnalytics(inputs, new Set([ALEX]), "employee", NOW, TODAY, 0);
    // Cycles 24h and 48h → median 36h.
    expect(a.median_cycle_hours).toBe(36);
  });

  it("does not mix an employee's private personal tasks into another scope", () => {
    const inputs = baseInputs({
      personalTasks: [{ id: "p1", owner_twin_id: ALEX, title: "Private therapy prep", due_at: `${TODAY}T09:00:00.000Z`, status: "done", recurrence: null, original_due_at: null, rollover_count: 1 }],
    });
    // Manager scope = manager's team, which does NOT include the private row unless owned.
    const team = notifWorkflowAnalytics(inputs, new Set([JORDAN, ALEX]), "manager", NOW, TODAY, 0);
    // rolled_over counts personal tasks inside the inputs (the function scopes rows before this call).
    expect(team.by_module.some((m) => m.module === "personal_task")).toBe(false);
    expect(Array.isArray(team.by_module)).toBe(true);
  });
});

describe("time helpers", () => {
  it("computes local date keys", () => {
    expect(notifDateKey("2026-09-19T23:00:00.000Z", -120)).toBe("2026-09-20");
    expect(notifDateKey("2026-09-19T23:00:00.000Z", 480)).toBe("2026-09-19");
  });
});
