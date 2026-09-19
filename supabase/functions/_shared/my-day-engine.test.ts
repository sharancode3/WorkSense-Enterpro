import { describe, expect, it } from "vitest";
import {
  buildMyDay,
  myDayDateKey,
  myDayDayDiff,
  myDayAddDays,
  myDayGroupOf,
  myDayPriorityFor,
  myDayStartOfDay,
  MYDAY_CALC_VERSION,
  type MyDayInputs,
} from "./my-day-engine.ts";

const NOW = "2026-09-19T08:00:00.000Z";
const CALLER = { id: "twin-a", role: "manager", org_id: "org-1", name: "Jordan Lee", job_title: "Engineering Manager", department: "Engineering" };

function baseInputs(overrides: Partial<MyDayInputs> = {}): MyDayInputs {
  return {
    caller: CALLER,
    sourceItems: [],
    personal: [],
    instances: [],
    prefs: { rollover_enabled: true, workday_start_hour: 9 },
    blockerDetails: {},
    now: NOW,
    tzOffsetMinutes: 0,
    ...overrides,
  };
}

describe("myDayDateKey / tz boundaries", () => {
  it("converts UTC instants into the local calendar day", () => {
    // UTC 23:00 on Sep 19 is Sep 20 in UTC+2 (offset -120).
    expect(myDayDateKey("2026-09-19T23:00:00.000Z", -120)).toBe("2026-09-20");
    expect(myDayDateKey("2026-09-19T23:00:00.000Z", 480)).toBe("2026-09-19");
    expect(myDayDateKey("2026-09-19T08:00:00.000Z", 0)).toBe("2026-09-19");
  });

  it("computes local midnight instants", () => {
    // Local midnight of Sep 19 in UTC+2 is 22:00 UTC Sep 18.
    expect(new Date(myDayStartOfDay("2026-09-19", -120)).toISOString()).toBe("2026-09-18T22:00:00.000Z");
    // UTC+8 (offset -480): local midnight is 16:00 UTC previous day.
    expect(new Date(myDayStartOfDay("2026-09-19", -480)).toISOString()).toBe("2026-09-18T16:00:00.000Z");
  });

  it("computes day diffs across week boundaries", () => {
    expect(myDayDayDiff("2026-09-19", "2026-09-21")).toBe(2);
    expect(myDayDayDiff("2026-09-19", "2026-09-14")).toBe(-5);
    expect(myDayAddDays("2026-09-30", 2)).toBe("2026-10-02");
  });
});

describe("priority engine (deterministic)", () => {
  const input = (over: { status?: string; overdue?: number; due?: string | null; blocker?: object | null; reason?: string | null; group?: "attention" | "ready" | "waiting" }) => ({
    status: (over.status ?? "todo") as MyDayInputs["personal"][number]["status"],
    origin: "workflow_task" as const,
    source_group: (over.group ?? "ready") as "attention" | "ready" | "waiting",
    overdue_days: over.overdue ?? 0,
    due_key: over.due,
    today_key: "2026-09-19",
    blocker: over.blocker ?? null,
    priority_reason: over.reason ?? null,
  });

  it("waiting items get the Waiting band", () => {
    const p = myDayPriorityFor(input({ status: "waiting" }));
    expect(p.band).toBe("Waiting");
    expect(p.value).toBe(0);
    expect(p.signals).toContain("waiting_on_other");
  });

  it("blocked items get Critical", () => {
    const p = myDayPriorityFor(input({ status: "blocked" }));
    expect(p.band).toBe("Critical");
    expect(p.signals).toContain("blocked");
  });

  it("overdue items get Critical with an overdue reason", () => {
    const p = myDayPriorityFor(input({ overdue: 3, due: "2026-09-16" }));
    expect(p.band).toBe("Critical");
    expect(p.reason).toContain("3 days");
    expect(p.signals).toContain("overdue");
  });

  it("due today gets Due soon", () => {
    const p = myDayPriorityFor(input({ due: "2026-09-19" }));
    expect(p.band).toBe("Due soon");
    expect(p.signals).toContain("due_today");
  });

  it("attention source items get Due soon with needs_review", () => {
    const p = myDayPriorityFor(input({ group: "attention", due: null }));
    expect(p.band).toBe("Due soon");
    expect(p.signals).toContain("needs_review");
  });

  it("everything else is Normal", () => {
    const p = myDayPriorityFor(input({ due: "2026-09-28" }));
    expect(p.band).toBe("Normal");
  });

  it("always carries the calc version", () => {
    expect(myDayPriorityFor(input({ due: "2026-09-19" })).calc_version).toBe(MYDAY_CALC_VERSION);
  });
});

describe("grouping", () => {
  const g = (over: { status?: string; origin?: string; sourceGroup?: "attention" | "ready" | "waiting" | "none"; overdue?: number; due?: string | null; today?: string }) =>
    myDayGroupOf({
      status: (over.status ?? "todo") as never,
      origin: (over.origin ?? "personal") as never,
      source_group: over.sourceGroup ?? "none",
      overdue_days: over.overdue ?? 0,
      due_key: over.due ?? null,
      today_key: over.today ?? "2026-09-19",
      week_end_key: "2026-09-25",
    });

  it("maps to the six checklist sections", () => {
    expect(g({ status: "done" })).toBe("completed");
    expect(g({ status: "blocked" })).toBe("attention");
    expect(g({ status: "waiting" })).toBe("waiting");
    expect(g({ status: "in_progress" })).toBe("in_progress");
    expect(g({ origin: "personal", due: "2026-09-19" })).toBe("today");
    expect(g({ origin: "personal", due: "2026-09-20" })).toBe("later");
    expect(g({ origin: "personal", overdue: 1 })).toBe("attention");
  });

  it("keeps source projection groups for workflow items", () => {
    expect(g({ origin: "workflow_task", sourceGroup: "attention" })).toBe("attention");
    expect(g({ origin: "workflow_task", sourceGroup: "waiting" })).toBe("waiting");
    expect(g({ origin: "workflow_task", sourceGroup: "ready", due: "2026-09-19" })).toBe("today");
    expect(g({ origin: "workflow_task", sourceGroup: "ready", due: "2026-09-28" })).toBe("later");
  });
});

describe("buildMyDay — composition", () => {
  it("surfaces a personal task inline with completion capability", () => {
    const res = buildMyDay(
      baseInputs({
        personal: [
          { id: "p1", title: "Draft the review notes", notes: null, due_at: "2026-09-19T09:00:00.000Z", recurrence: null, status: "todo", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
        ],
      })
    );
    expect(res.items).toHaveLength(1);
    const item = res.items[0];
    expect(item.id).toBe("personal:p1");
    expect(item.inline_completable).toBe(true);
    expect(item.group).toBe("today");
    expect(item.priority.band).toBe("Due soon");
    expect(item.source.module).toBe("personal");
  });

  it("rollover is surfaced as carried_from without losing the original date", () => {
    const res = buildMyDay(
      baseInputs({
        personal: [
          { id: "p1", title: "Old task", notes: null, due_at: "2026-09-19T09:00:00.000Z", recurrence: null, status: "todo", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, original_due_at: "2026-09-17T09:00:00.000Z", rollover_count: 2, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 3 },
        ],
      })
    );
    const item = res.items[0];
    expect(item.carried_from).toEqual({ original_due_at: "2026-09-17T09:00:00.000Z", days: 2 });
  });

  it("source items are referenced — never inline completable, deep link preserved", () => {
    const res = buildMyDay(
      baseInputs({
        sourceItems: [
          { id: "approval:rec-1", type: "approval_request", title: "Approve: upskilling (high)", subject: "Team member", subject_id: "twin-x", owner_label: "Approval", source_group: "attention", authorized_actions: ["review", "approve", "reject"], status_label: "Needs review", due_at: null, priority_reason: "Urgency high", blocker: null, source: { workflow: "recommendation", version: 2, ref_id: "rec-1" }, deep_link: "/hub?rec=rec-1" },
        ],
      })
    );
    const item = res.items[0];
    expect(item.inline_completable).toBe(false);
    expect(item.deep_link).toBe("/hub?rec=rec-1");
    expect(item.origin).toBe("approval");
    expect(item.source.module).toBe("recommendations");
    expect(item.canonical_action).toBe("review");
    expect(item.status).toBe("todo");
  });

  it("blocked source items surface as blocked with priority Critical", () => {
    const res = buildMyDay(
      baseInputs({
        sourceItems: [
          { id: "onboarding:plan1:access_sso", type: "onboarding_task", title: "Blocked: Access SSO", subject: "Alex Chen", subject_id: "twin-x", owner_label: "Employee", source_group: "attention", authorized_actions: ["resolve_blocker"], status_label: "Needs attention", due_at: null, priority_reason: "Blocked — stalls the onboarding journey", blocker: "laptop not provisioned", source: { workflow: "onboarding_plan", version: 1, ref_id: "plan1" }, deep_link: "/onboarding?twin=twin-x" },
        ],
        blockerDetails: {
          "onboarding:plan1:access_sso": { reason: "laptop not provisioned", owner_label: "IT Security", recorded_at: "2026-09-18T10:00:00.000Z", next_action: "Resolve or reassign in the onboarding center", downstream_impact: "Stalls the onboarding journey" },
        },
      })
    );
    const item = res.items[0];
    expect(item.status).toBe("blocked");
    expect(item.group).toBe("attention");
    expect(item.priority.band).toBe("Critical");
    expect(item.blocker?.owner_label).toBe("IT Security");
    expect(item.blocker?.downstream_impact).toBe("Stalls the onboarding journey");
  });

  it("waiting items never count toward the completion denominator", () => {
    const res = buildMyDay(
      baseInputs({
        sourceItems: [
          { id: "onboarding:plan1:payroll", type: "onboarding_task", title: "Payroll enrolment (queued)", subject: "Alex Chen", subject_id: "twin-x", owner_label: "HR", source_group: "waiting", authorized_actions: [], status_label: "Waiting on HR", due_at: null, priority_reason: null, blocker: null, source: { workflow: "onboarding_plan", version: 1, ref_id: "plan1" }, deep_link: "/onboarding?twin=twin-x" },
        ],
        personal: [
          { id: "p1", title: "Today personal", notes: null, due_at: "2026-09-19T09:00:00.000Z", recurrence: null, status: "done", snoozed_until: null, state_note: null, completed_at: "2026-09-19T07:00:00.000Z", completion_evidence: "done", original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
          { id: "p2", title: "Waiting personal", notes: null, due_at: "2026-09-19T09:00:00.000Z", recurrence: null, status: "waiting", snoozed_until: null, state_note: "waiting on inputs", completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
          { id: "p3", title: "Blocked personal", notes: null, due_at: "2026-09-19T09:00:00.000Z", recurrence: null, status: "blocked", snoozed_until: null, state_note: "blocked", completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
        ],
      })
    );
    // Denominator = personal+routine due today in todo/in_progress/done = 1 (p1).
    expect(res.analytics.today.eligible_personal_today).toBe(1);
    expect(res.analytics.today.done_personal_today).toBe(1);
    expect(res.analytics.today.completion_pct).toBe(100);
    // Waiting counts every waiting item (personal + source), but none enter the denominator.
    expect(res.analytics.today.waiting).toBe(2);
    expect(res.analytics.today.blocked).toBe(1);
  });

  it("badge counts only actionable items (attention + due today), not totals", () => {
    const res = buildMyDay(
      baseInputs({
        sourceItems: [
          { id: "approval:rec-1", type: "approval_request", title: "Approve: upskilling", subject: "Team member", subject_id: "twin-x", owner_label: "Approval", source_group: "attention", authorized_actions: ["review"], status_label: "Needs review", due_at: null, priority_reason: null, blocker: null, source: { workflow: "recommendation", version: 1, ref_id: "rec-1" }, deep_link: "/hub?rec=rec-1" },
          { id: "onboarding:plan1:payroll", type: "onboarding_task", title: "Payroll (queued)", subject: "Alex Chen", subject_id: "twin-x", owner_label: "HR", source_group: "waiting", authorized_actions: [], status_label: "Waiting on HR", due_at: null, priority_reason: null, blocker: null, source: { workflow: "onboarding_plan", version: 1, ref_id: "plan1" }, deep_link: "/onboarding?twin=twin-x" },
        ],
        personal: [
          { id: "p1", title: "Due today", notes: null, due_at: "2026-09-19T09:00:00.000Z", recurrence: null, status: "todo", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
          { id: "p2", title: "Later", notes: null, due_at: "2026-09-25T09:00:00.000Z", recurrence: null, status: "todo", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
        ],
      })
    );
    // attention:1 (approval) + today:1 (p1) = 2; waiting and later excluded.
    expect(res.badge).toBe(2);
    expect(res.summary.waiting).toBe(1);
  });

  it("dismissed and future-snoozed items leave the list but stay in dismissed_items for undo; expired snooze reappears", () => {
    const res = buildMyDay(
      baseInputs({
        personal: [
          { id: "p1", title: "Dismissed", notes: null, due_at: null, recurrence: null, status: "dismissed", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
          { id: "p2", title: "Snoozed future", notes: null, due_at: null, recurrence: null, status: "snoozed", snoozed_until: "2026-09-20T00:00:00.000Z", state_note: null, completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
          { id: "p3", title: "Snoozed expired", notes: null, due_at: null, recurrence: null, status: "snoozed", snoozed_until: "2026-09-18T00:00:00.000Z", state_note: null, completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
        ],
      })
    );
    expect(res.items.map((i) => i.id)).toEqual(["personal:p3"]);
    expect(res.items[0].status).toBe("todo");
    expect(res.dismissed_items.map((i) => i.id)).toEqual(["personal:p1", "personal:p2"]);
  });

  it("routine instances carry their recurrence info and group by occurrence date", () => {
    const res = buildMyDay(
      baseInputs({
        instances: [
          { id: "i1", rule_type: "system", rule_key: "system:team:approvals", freq: "daily", occurrence_date: "2026-09-19", due_at: "2026-09-19T08:30:00.000Z", title: "Clear team approvals & requests", notes: null, source_module: "recommendations", source_resource_type: null, source_resource_id: null, canonical_action: "approve", deep_link: "/hub", status: "todo", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, rollover_count: 0, version: 1 },
          { id: "i2", rule_type: "system", rule_key: "system:team:checkin", freq: "weekly", occurrence_date: "2026-09-23", due_at: "2026-09-23T11:00:00.000Z", title: "Weekly 1:1 check-in", notes: null, source_module: "workforce_review", source_resource_type: null, source_resource_id: null, canonical_action: "review", deep_link: "/workforce", status: "todo", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, rollover_count: 0, version: 1 },
        ],
      })
    );
    const today = res.items.find((i) => i.id === "routine:i1")!;
    const later = res.items.find((i) => i.id === "routine:i2")!;
    expect(today.group).toBe("today");
    expect(today.recurrence).toEqual({ freq: "daily", occurrence_date: "2026-09-19" });
    expect(today.inline_completable).toBe(true);
    expect(later.group).toBe("later");
  });

  it("renders exactly the rows the function scoped to the caller (ownership is enforced by the query, before the engine)", () => {
    const res = buildMyDay(
      baseInputs({
        personal: [
          { id: "p-other", title: "Private routine", notes: null, due_at: "2026-09-19T09:00:00.000Z", recurrence: null, status: "todo", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
        ],
      })
    );
    // The my-day function only ever loads rows WHERE owner_twin_id = caller.id;
    // the engine composes what it is given and cannot leak rows it never saw.
    expect(res.items.map((i) => i.id)).toEqual(["personal:p-other"]);
  });

  it("module distribution and 7-day trend match the input rows", () => {
    const res = buildMyDay(
      baseInputs({
        personal: [
          { id: "p1", title: "Task", notes: null, due_at: "2026-09-19T09:00:00.000Z", recurrence: null, status: "todo", snoozed_until: null, state_note: null, completed_at: "2026-09-18T09:00:00.000Z", completion_evidence: "x", original_due_at: null, rollover_count: 0, source_module: null, source_resource_type: null, source_resource_id: null, canonical_action: null, deep_link: null, version: 1 },
        ],
        sourceItems: [
          { id: "approval:rec-1", type: "approval_request", title: "Approve", subject: "Team", subject_id: "twin-x", owner_label: "Approval", source_group: "attention", authorized_actions: ["review"], status_label: "Needs review", due_at: null, priority_reason: null, blocker: null, source: { workflow: "recommendation", version: 1, ref_id: "rec-1" }, deep_link: "/hub?rec=rec-1" },
        ],
        instances: [
          { id: "i1", rule_type: "system", rule_key: "system:it:provisioning", freq: "daily", occurrence_date: "2026-09-19", due_at: "2026-09-19T09:00:00.000Z", title: "Provision", notes: null, source_module: "access", source_resource_type: null, source_resource_id: null, canonical_action: "provision", deep_link: "/onboarding", status: "done", snoozed_until: null, state_note: null, completed_at: "2026-09-19T07:30:00.000Z", completion_evidence: "done", rollover_count: 0, version: 1 },
          { id: "i2", rule_type: "system", rule_key: "system:it:audit", freq: "weekly", occurrence_date: "2026-09-19", due_at: "2026-09-19T15:00:00.000Z", title: "Weekly audit", notes: null, source_module: "access", source_resource_type: null, source_resource_id: null, canonical_action: "audit", deep_link: "/admin/access", status: "todo", snoozed_until: null, state_note: null, completed_at: null, completion_evidence: null, rollover_count: 0, version: 1 },
        ],
      })
    );
    const mods = res.analytics.modules.map((m) => m.label);
    // Routines aggregate under "Routine"; personal under "Personal".
    expect(mods).toEqual(expect.arrayContaining(["Recommendations", "Personal", "Routine"]));
    const trendToday = res.analytics.trend7.find((t) => t.date === "2026-09-19")!;
    expect(trendToday.routines).toBe(1);
    const trendYesterday = res.analytics.trend7.find((t) => t.date === "2026-09-18")!;
    expect(trendYesterday.personal).toBe(1);
    expect(res.analytics.rhythm.days_active_last7).toBe(2);
    expect(res.analytics.honesty.length).toBeGreaterThan(0);
  });

  it("produces stable grouped output shape", () => {
    const res = buildMyDay(baseInputs());
    expect(res.ok).toBe(true);
    expect(res.groups).toEqual(["attention", "today", "in_progress", "waiting", "later", "completed"]);
    expect(res.summary.total_open).toBe(0);
    expect(res.badge).toBe(0);
    expect(res.today_date).toBe("2026-09-19");
    expect(res.prefs.rollover_enabled).toBe(true);
  });
});
