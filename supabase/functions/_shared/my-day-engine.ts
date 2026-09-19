// ---------------------------------------------------------------------------
// WorkSense Phase 33 — "My Day" engine (deterministic, pure, zero LLM).
//
// Combines the role-scoped source projection (built by the my-work engine from
// canonical workflow records) with the personal / routine / local-view layer:
//
//   - Source-backed items are REFERENCED, never duplicated or mutated. Their
//     authoritative action always happens in the owning center (deep link).
//     The only local state they accept is dismiss / snooze (myday_item_state).
//   - Personal tasks and recurring-routine instances are fully inline:
//     they complete with optional evidence, block, snooze, dismiss.
//   - The priority engine is deterministic (band + numeric + human reason +
//     signals + calc version). It never uses an LLM.
//   - "My rhythm" analytics are deliberately NON-evaluative: there is no
//     productivity/efficiency score; completion denominators exclude waiting,
//     blocked and informational items; streaks are private to the user.
//
// This module is bundled into the my-day backend function and also unit-tested
// directly (see my-day-engine.test.ts). It imports nothing.
// ---------------------------------------------------------------------------

export type MyDayOrigin =
  | "workflow_task"
  | "approval"
  | "review"
  | "assessment"
  | "requisition"
  | "data_quality"
  | "personal"
  | "recurring_routine"
  | "informational";

export type MyDayStatus = "todo" | "in_progress" | "waiting" | "blocked" | "done" | "dismissed" | "snoozed";
export type MyDayGroup = "attention" | "today" | "in_progress" | "waiting" | "later" | "completed";
export type MyDayBand = "Critical" | "Due soon" | "Normal" | "Waiting";
export type MyDayView = "today" | "week" | "all";

export interface MyDayBlocker {
  reason: string;
  owner_label: string | null;
  recorded_at: string | null;
  next_action: string;
  downstream_impact: string | null;
}

export interface MyDayPriority {
  band: MyDayBand;
  value: number;
  reason: string;
  signals: string[];
  calc_version: number;
}

export interface MyDayCarry {
  original_due_at: string;
  days: number;
}

export interface MyDayItem {
  id: string;
  origin: MyDayOrigin;
  type: string;
  title: string;
  subject: string;
  subject_id: string;
  owner_label: string;
  status: MyDayStatus;
  source_group: "attention" | "ready" | "waiting" | "none";
  group: MyDayGroup;
  priority: MyDayPriority;
  due_at: string | null;
  due_key: string | null;
  overdue_days: number;
  deep_link: string | null;
  canonical_action: string | null;
  inline_completable: boolean;
  blocker: MyDayBlocker | null;
  carried_from: MyDayCarry | null;
  recurrence: MyDayRecurrenceInfo | null;
  evidence: { text: string; at: string } | null;
  version: number;
  source: {
    module: string;
    resource_type: string | null;
    resource_id: string | null;
    workflow: string;
    version: number | null;
    ref_id: string;
  };
  can_dismiss: boolean;
  can_snooze: boolean;
}

export interface MyDayRecurrenceInfo {
  freq: "daily" | "weekly";
  occurrence_date: string;
}

// ---------------------------------------------------------------------------
// Engine inputs — produced by the my-day backend function from real rows.
// ---------------------------------------------------------------------------

export interface MyDaySourceItem {
  id: string; // stable item key (from the my-work engine)
  type: string; // WorkItemType from the my-work engine
  title: string;
  subject: string;
  subject_id: string;
  owner_label: string;
  source_group: "attention" | "ready" | "waiting";
  authorized_actions: string[];
  status_label: string;
  due_at: string | null;
  priority_reason: string | null;
  blocker: string | null;
  source: { workflow: string; version: number | null; ref_id: string };
  deep_link: string;
}

export interface MyDayPersonalRow {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  recurrence: { freq: "daily" | "weekly"; weekdays: number[]; day_time: string | null } | null;
  status: MyDayStatus;
  snoozed_until: string | null;
  state_note: string | null;
  completed_at: string | null;
  completion_evidence: string | null;
  original_due_at: string | null;
  rollover_count: number;
  source_module: string | null;
  source_resource_type: string | null;
  source_resource_id: string | null;
  canonical_action: string | null;
  deep_link: string | null;
  version: number;
}

export interface MyDayInstanceRow {
  id: string;
  rule_type: "personal" | "system";
  rule_key: string;
  freq: "daily" | "weekly";
  occurrence_date: string; // YYYY-MM-DD
  due_at: string | null;
  title: string;
  notes: string | null;
  source_module: string | null;
  source_resource_type: string | null;
  source_resource_id: string | null;
  canonical_action: string | null;
  deep_link: string | null;
  status: MyDayStatus;
  snoozed_until: string | null;
  state_note: string | null;
  completed_at: string | null;
  completion_evidence: string | null;
  rollover_count: number;
  version: number;
}

export interface MyDayPrefs {
  rollover_enabled: boolean;
  workday_start_hour: number;
}

export interface MyDayInputs {
  caller: { id: string; role: string; org_id: string; name: string; job_title: string | null; department: string | null };
  sourceItems: MyDaySourceItem[];
  personal: MyDayPersonalRow[];
  instances: MyDayInstanceRow[];
  prefs: MyDayPrefs;
  blockerDetails: { [itemKey: string]: MyDayBlocker };
  /** Source item keys hidden by local dismiss/active-snooze (myday_item_state). */
  hiddenItemKeys?: string[];
  now: string; // ISO (UTC)
  tzOffsetMinutes: number; // matches new Date().getTimezoneOffset() for the client
}

export interface MyDaySummary {
  total_open: number;
  attention: number;
  due_today: number;
  in_progress: number;
  waiting: number;
  completed_today: number;
  overdue_count: number;
  blocked_count: number;
}

export interface MyDayAnalytics {
  today: {
    eligible_personal_today: number;
    done_personal_today: number;
    completion_pct: number | null;
    open_workflow_today: number;
    blocked: number;
    waiting: number;
    note: string;
  };
  trend7: { date: string; done: number; personal: number; routines: number }[];
  modules: { module: string; label: string; count: number }[];
  rhythm: { days_active_last7: number; days_total: number; this_week_done: number; private_note: string };
  workflow_health: { attention: number; ready: number; waiting: number; note: string };
  honesty: string[];
}

export interface MyDayResult {
  ok: true;
  role: string;
  name: string;
  job_title: string | null;
  department: string | null;
  generated_at: string;
  server_time: string;
  tz_offset_minutes: number;
  today_date: string;
  view: MyDayView;
  summary: MyDaySummary;
  badge: number;
  groups: MyDayGroup[];
  items: MyDayItem[];
  /** Dismissed / actively-snoozed items — shown so the user can undo. */
  dismissed_items: MyDayItem[];
  analytics: MyDayAnalytics;
  prefs: MyDayPrefs;
  personal_count: number;
  routine_count: number;
}

export const MYDAY_GROUP_ORDER: MyDayGroup[] = ["attention", "today", "in_progress", "waiting", "later", "completed"];
export const MYDAY_CALC_VERSION = 1;
export const MYDAY_HONESTY: string[] = [
  "Personal & routine completions are checked off here; workflow records complete inside their own centers, never locally.",
  "Completion rates exclude waiting, blocked and informational items — those are surfaced separately.",
  "There is no productivity or efficiency score. Rhythm data is private to you.",
];

// ---------------------------------------------------------------------------
// Time helpers. offset is in minutes and equals new Date().getTimezoneOffset()
// for the viewing client (UTC = local + offset).
// ---------------------------------------------------------------------------

function myDayAddMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

/** Local calendar date (YYYY-MM-DD) for a UTC instant under the given offset. */
export function myDayDateKey(iso: string, tzOffsetMinutes: number): string {
  return myDayAddMinutes(iso, -tzOffsetMinutes).slice(0, 10);
}

/** UTC instant (ms) of local midnight on the given local date key. */
export function myDayStartOfDay(dateKey: string, tzOffsetMinutes: number): number {
  return Date.parse(`${dateKey}T00:00:00.000Z`) + tzOffsetMinutes * 60000;
}

export function myDayAddDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** UTC ISO instant for a local date + local clock ("HH:MM"). */
export function myDayLocalToIso(dateKey: string, clock: string, tzOffsetMinutes: number): string {
  const ms = Date.parse(`${dateKey}T${clock}:00.000Z`) + tzOffsetMinutes * 60000;
  return new Date(ms).toISOString();
}

/** Monday-start week key containing the given date key. */
export function myDayWeekStart(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  const dow = d.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Whole-day diff between two date keys (b - a in days). */
export function myDayDayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86400000);
}

// ---------------------------------------------------------------------------
// Source type -> origin / module / canonical-action mapping.
// ---------------------------------------------------------------------------

const MYDAY_TYPE_ORIGIN: Record<string, MyDayOrigin> = {
  onboarding_task: "workflow_task",
  provisioning_request: "workflow_task",
  recommendation_task: "workflow_task",
  approval_request: "approval",
  review_case: "review",
  candidate_next_step: "workflow_task",
  assessment_session: "assessment",
  requisition_attention: "requisition",
  data_quality_alert: "data_quality",
  policy_escalation: "workflow_task",
};

const MYDAY_TYPE_MODULE: Record<string, string> = {
  onboarding_task: "onboarding",
  provisioning_request: "access",
  recommendation_task: "recommendations",
  approval_request: "recommendations",
  review_case: "workforce_review",
  candidate_next_step: "recruitment",
  assessment_session: "recruitment",
  requisition_attention: "recruitment",
  data_quality_alert: "skill_data",
  policy_escalation: "policies",
};

const MYDAY_TYPE_ACTION: Record<string, string> = {
  onboarding_task: "complete",
  provisioning_request: "provision",
  recommendation_task: "complete",
  approval_request: "review",
  review_case: "review",
  candidate_next_step: "advance",
  assessment_session: "review",
  requisition_attention: "review",
  data_quality_alert: "review",
  policy_escalation: "review",
};

export function myDayModuleLabel(module: string): string {
  switch (module) {
    case "onboarding":
      return "Onboarding";
    case "access":
      return "Access & security";
    case "recommendations":
      return "Recommendations";
    case "workforce_review":
      return "Workforce review";
    case "recruitment":
      return "Recruitment";
    case "skill_data":
      return "Skill data";
    case "policies":
      return "Policies";
    case "admin":
      return "Governance";
    case "personal":
      return "Personal";
    case "routine":
      return "Routine";
    default:
      return module;
  }
}

/** Module / origin / canonical action for a source WorkItem type. */
export function myDaySourceMetaForType(type: string): { origin: MyDayOrigin; module: string; action: string | null } {
  return {
    origin: MYDAY_TYPE_ORIGIN[type] ?? "workflow_task",
    module: MYDAY_TYPE_MODULE[type] ?? type,
    action: MYDAY_TYPE_ACTION[type] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Deterministic priority engine (band + numeric + reason + signals).
// ---------------------------------------------------------------------------

interface MyDayPriorityInput {
  status: MyDayStatus;
  origin: MyDayOrigin;
  source_group: "attention" | "ready" | "waiting" | "none";
  overdue_days: number;
  due_key: string | null;
  today_key: string;
  blocker: MyDayBlocker | null;
  priority_reason: string | null;
}

export function myDayPriorityFor(input: MyDayPriorityInput): MyDayPriority {
  const signals: string[] = [];

  if (input.status === "waiting" || input.source_group === "waiting") {
    signals.push("waiting_on_other");
    return {
      band: "Waiting",
      value: 0,
      reason: "Waiting on someone else — tracked separately, never counted against you.",
      signals,
      calc_version: MYDAY_CALC_VERSION,
    };
  }

  if (input.status === "blocked") {
    signals.push("blocked");
    return { band: "Critical", value: 3, reason: "Blocked — unblock to keep the flow moving.", signals, calc_version: MYDAY_CALC_VERSION };
  }

  if (input.overdue_days > 0) {
    signals.push("overdue");
    return {
      band: "Critical",
      value: 3,
      reason: `Overdue by ${input.overdue_days} day${input.overdue_days > 1 ? "s" : ""}.`,
      signals,
      calc_version: MYDAY_CALC_VERSION,
    };
  }

  const urgent = input.blocker != null || /urgency\s+(critical|high)|blocked|failed|stalls|expired|awaiting\s+verification/i.test(input.priority_reason ?? "");
  if (urgent) {
    signals.push("needs_action");
    return { band: "Critical", value: 3, reason: input.priority_reason ?? "Needs action now.", signals, calc_version: MYDAY_CALC_VERSION };
  }

  if (input.source_group === "attention") {
    signals.push("needs_review");
    return { band: "Due soon", value: 2, reason: "Needs your attention.", signals, calc_version: MYDAY_CALC_VERSION };
  }

  if (input.due_key != null && input.due_key === input.today_key) {
    signals.push("due_today");
    return { band: "Due soon", value: 2, reason: "Due today.", signals, calc_version: MYDAY_CALC_VERSION };
  }

  if (input.due_key != null) {
    const daysOut = myDayDayDiff(input.today_key, input.due_key);
    if (daysOut <= 2) {
      signals.push("due_soon");
      return { band: "Due soon", value: 2, reason: daysOut <= 0 ? "Due today or overdue." : `Due in ${daysOut} day${daysOut > 1 ? "s" : ""}.`, signals, calc_version: MYDAY_CALC_VERSION };
    }
  }

  signals.push(input.origin === "personal" || input.origin === "recurring_routine" ? "personal" : "scheduled");
  return { band: "Normal", value: 1, reason: "On your list — no deadline pressure today.", signals, calc_version: MYDAY_CALC_VERSION };
}

// ---------------------------------------------------------------------------
// Grouping (the six checklist sections).
// ---------------------------------------------------------------------------

interface MyDayGroupInput {
  status: MyDayStatus;
  origin: MyDayOrigin;
  source_group: "attention" | "ready" | "waiting" | "none";
  overdue_days: number;
  due_key: string | null;
  today_key: string;
  week_end_key: string;
}

export function myDayGroupOf(input: MyDayGroupInput): MyDayGroup {
  if (input.status === "done") return "completed";
  if (input.status === "blocked") return "attention";
  if (input.status === "waiting") return "waiting";
  if (input.status === "in_progress") return input.overdue_days > 0 ? "attention" : "in_progress";

  const isLocal = input.origin === "personal" || input.origin === "recurring_routine";
  if (isLocal) {
    if (input.overdue_days > 0) return "attention";
    if (input.due_key != null && input.due_key === input.today_key) return "today";
    return "later";
  }

  // Source-backed items keep their projection group as the primary signal.
  if (input.source_group === "attention") return "attention";
  if (input.source_group === "waiting") return "waiting";
  // "ready" items are actionable now — do them today unless scheduled later.
  if (input.due_key != null && input.due_key > input.week_end_key) return "later";
  return "today";
}

export function myDayCompareItems(a: MyDayItem, b: MyDayItem): number {
  const g = MYDAY_GROUP_ORDER.indexOf(a.group) - MYDAY_GROUP_ORDER.indexOf(b.group);
  if (g !== 0) return g;
  if (a.priority.value !== b.priority.value) return b.priority.value - a.priority.value;
  if (a.overdue_days !== b.overdue_days) return b.overdue_days - a.overdue_days;
  const da = a.due_key ?? "9999";
  const db = b.due_key ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  return a.title.localeCompare(b.title);
}

// ---------------------------------------------------------------------------
// Analytics — ethical by construction.
// ---------------------------------------------------------------------------

export function myDayAnalyticsFor(
  items: MyDayItem[],
  personalDone: { date: string }[],
  instanceDone: { date: string }[],
  today: string,
  tzOffsetMinutes: number
): MyDayAnalytics {
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) dayKeys.push(myDayAddDays(today, -i));

  const countOn = (rows: { date: string }[], key: string) => rows.filter((r) => myDayDateKey(r.date, tzOffsetMinutes) === key).length;

  const trend7 = dayKeys.map((date) => ({
    date,
    personal: countOn(personalDone, date),
    routines: countOn(instanceDone, date),
    done: countOn(personalDone, date) + countOn(instanceDone, date),
  }));

  const openToday = items.filter(
    (i) => i.status !== "done" && ["attention", "today", "in_progress"].includes(i.group)
  );
  const eligiblePersonalToday = items.filter(
    (i) =>
      (i.origin === "personal" || i.origin === "recurring_routine") &&
      i.due_key === today &&
      ["todo", "in_progress", "done"].includes(i.status)
  );
  const donePersonalToday = eligiblePersonalToday.filter((i) => i.status === "done");
  const blocked = items.filter((i) => i.status === "blocked" || (i.blocker != null && i.status !== "done"));
  const waiting = items.filter((i) => i.group === "waiting" && i.status !== "done");

  const moduleCounts = new Map<string, number>();
  for (const i of openToday) {
    const key = i.origin === "personal" ? "personal" : i.origin === "recurring_routine" ? "routine" : i.source.module;
    moduleCounts.set(key, (moduleCounts.get(key) ?? 0) + 1);
  }
  const modules = [...moduleCounts.entries()]
    .map(([m, count]) => ({ module: m, label: myDayModuleLabel(m), count }))
    .sort((a, b) => b.count - a.count);

  const allDone = [...personalDone, ...instanceDone];
  const daysActiveLast7 = dayKeys.filter((d) => countOn(allDone, d) > 0).length;
  const weekStart = myDayWeekStart(today);
  const thisWeekDone = allDone.filter((r) => {
    const k = myDayDateKey(r.date, tzOffsetMinutes);
    return k >= weekStart && k <= today;
  }).length;

  const sourceToday = items.filter(
    (i) => i.origin !== "personal" && i.origin !== "recurring_routine" && i.status !== "done"
  );
  const workflowHealth = {
    attention: sourceToday.filter((i) => i.source_group === "attention").length,
    ready: sourceToday.filter((i) => i.source_group === "ready").length,
    waiting: sourceToday.filter((i) => i.source_group === "waiting").length,
    note: "Workflow actions complete in their own centers. Waiting & blocked items are excluded from completion rates.",
  };

  const completionPct = eligiblePersonalToday.length > 0 ? Math.round((donePersonalToday.length / eligiblePersonalToday.length) * 100) : null;

  return {
    today: {
      eligible_personal_today: eligiblePersonalToday.length,
      done_personal_today: donePersonalToday.length,
      completion_pct: completionPct,
      open_workflow_today: sourceToday.filter((i) => i.source_group !== "waiting").length,
      blocked: blocked.length,
      waiting: waiting.length,
      note: "Personal & routine completion today. Blocked and waiting items are excluded from the denominator.",
    },
    trend7,
    modules,
    rhythm: {
      days_active_last7: daysActiveLast7,
      days_total: 7,
      this_week_done: thisWeekDone,
      private_note: "Your rhythm is private to you — a consistency signal, never a productivity score.",
    },
    workflow_health: workflowHealth,
    honesty: MYDAY_HONESTY,
  };
}

// ---------------------------------------------------------------------------
// Main builder.
// ---------------------------------------------------------------------------

export function buildMyDay(inputs: MyDayInputs, view: MyDayView = "today"): MyDayResult {
  const now = inputs.now;
  const offset = inputs.tzOffsetMinutes;
  const today = myDayDateKey(now, offset);
  const startOfTodayMs = myDayStartOfDay(today, offset);
  const weekEndKey = myDayAddDays(today, 6);
  const nowMs = Date.parse(now);
  const hiddenItemKeys = new Set(inputs.hiddenItemKeys ?? []);
  const items: MyDayItem[] = [];
  const hidden: MyDayItem[] = [];

  // ---- Personal (one-off) tasks -------------------------------------------
  for (const p of inputs.personal) {
    if (p.recurrence) continue; // recurring personal tasks materialize as instances
    const snoozedFuture = p.status === "snoozed" && p.snoozed_until != null && Date.parse(p.snoozed_until) > nowMs;
    const isHidden = p.status === "dismissed" || snoozedFuture;
    const effectiveStatus: MyDayStatus =
      p.status === "snoozed" && p.snoozed_until != null && Date.parse(p.snoozed_until) <= nowMs ? "todo" : p.status;
    const dueKey = p.due_at ? myDayDateKey(p.due_at, offset) : null;
    const dueMs = p.due_at ? Date.parse(p.due_at) : null;
    const overdue = dueMs != null && effectiveStatus !== "done" && dueMs < startOfTodayMs ? Math.floor((startOfTodayMs - dueMs) / 86400000) : 0;

    const item: MyDayItem = {
      id: `personal:${p.id}`,
      origin: "personal",
      type: "personal_task",
      title: p.title,
      subject: "You",
      subject_id: inputs.caller.id,
      owner_label: "You",
      status: effectiveStatus,
      source_group: "none",
      group: "later",
      priority: myDayPriorityFor({
        status: effectiveStatus,
        origin: "personal",
        source_group: "none",
        overdue_days: overdue,
        due_key: dueKey,
        today_key: today,
        blocker: null,
        priority_reason: null,
      }),
      due_at: p.due_at,
      due_key: dueKey,
      overdue_days: overdue,
      deep_link: p.deep_link,
      canonical_action: p.canonical_action,
      inline_completable: true,
      blocker: null,
      carried_from: p.rollover_count > 0 ? { original_due_at: p.original_due_at ?? p.due_at ?? "", days: p.rollover_count } : null,
      recurrence: null,
      evidence: p.completed_at ? { text: p.completion_evidence ?? "", at: p.completed_at } : null,
      version: p.version,
      source: {
        module: p.source_module ?? "personal",
        resource_type: p.source_resource_type,
        resource_id: p.source_resource_id,
        workflow: p.source_module ? (p.source_module === "onboarding" ? "onboarding_plan" : p.source_module) : "personal_task",
        version: null,
        ref_id: p.id,
      },
      can_dismiss: true,
      can_snooze: true,
    };
    item.group = myDayGroupOf({
      status: item.status,
      origin: item.origin,
      source_group: "none",
      overdue_days: item.overdue_days,
      due_key: item.due_key,
      today_key: today,
      week_end_key: weekEndKey,
    });
    if (isHidden) {
      hidden.push(item);
      continue;
    }
    items.push(item);
  }

  // ---- Recurring-routine instances -----------------------------------------
  for (const r of inputs.instances) {
    const snoozedFuture = r.status === "snoozed" && r.snoozed_until != null && Date.parse(r.snoozed_until) > nowMs;
    const isHidden = r.status === "dismissed" || snoozedFuture;
    const effectiveStatus: MyDayStatus =
      r.status === "snoozed" && r.snoozed_until != null && Date.parse(r.snoozed_until) <= nowMs ? "todo" : r.status;
    const dueMs = r.due_at ? Date.parse(r.due_at) : myDayStartOfDay(r.occurrence_date, offset);
    const dueKey = r.due_at ? myDayDateKey(r.due_at, offset) : r.occurrence_date;
    const overdue = effectiveStatus !== "done" && dueMs < startOfTodayMs ? Math.floor((startOfTodayMs - dueMs) / 86400000) : 0;

    const item: MyDayItem = {
      id: `routine:${r.id}`,
      origin: "recurring_routine",
      type: "routine_instance",
      title: r.title,
      subject: "You",
      subject_id: inputs.caller.id,
      owner_label: "You",
      status: effectiveStatus,
      source_group: "none",
      group: "later",
      priority: myDayPriorityFor({
        status: effectiveStatus,
        origin: "recurring_routine",
        source_group: "none",
        overdue_days: overdue,
        due_key: dueKey,
        today_key: today,
        blocker: null,
        priority_reason: null,
      }),
      due_at: r.due_at,
      due_key: dueKey,
      overdue_days: overdue,
      deep_link: r.deep_link,
      canonical_action: r.canonical_action,
      inline_completable: true,
      blocker: null,
      carried_from: r.rollover_count > 0 ? { original_due_at: r.occurrence_date, days: r.rollover_count } : null,
      recurrence: { freq: r.freq, occurrence_date: r.occurrence_date },
      evidence: r.completed_at ? { text: r.completion_evidence ?? "", at: r.completed_at } : null,
      version: r.version,
      source: {
        module: r.source_module ?? "routine",
        resource_type: r.source_resource_type,
        resource_id: r.source_resource_id,
        workflow: r.rule_type === "system" ? "system_routine" : "personal_routine",
        version: null,
        ref_id: r.id,
      },
      can_dismiss: true,
      can_snooze: true,
    };
    item.group = myDayGroupOf({
      status: item.status,
      origin: item.origin,
      source_group: "none",
      overdue_days: item.overdue_days,
      due_key: item.due_key,
      today_key: today,
      week_end_key: weekEndKey,
    });
    if (isHidden) {
      hidden.push(item);
      continue;
    }
    items.push(item);
  }

  // ---- Source-backed projection items (referenced, never mutated) ----------
  for (const s of inputs.sourceItems) {
    const origin = MYDAY_TYPE_ORIGIN[s.type] ?? "workflow_task";
    const dueKey = s.due_at ? myDayDateKey(s.due_at, offset) : null;
    const dueMs = s.due_at ? Date.parse(s.due_at) : null;
    const overdue = dueMs != null && dueMs < startOfTodayMs ? Math.floor((startOfTodayMs - dueMs) / 86400000) : 0;
    const status: MyDayStatus =
      s.source_group === "waiting" ? "waiting" : s.source_group === "attention" ? (s.blocker != null ? "blocked" : "todo") : "todo";
    const blocker = inputs.blockerDetails[s.id] ?? null;

    const item: MyDayItem = {
      id: s.id,
      origin,
      type: s.type,
      title: s.title,
      subject: s.subject,
      subject_id: s.subject_id,
      owner_label: s.owner_label,
      status,
      source_group: s.source_group,
      group: "later",
      priority: myDayPriorityFor({
        status,
        origin,
        source_group: s.source_group,
        overdue_days: Math.max(0, overdue),
        due_key: dueKey,
        today_key: today,
        blocker,
        priority_reason: s.priority_reason,
      }),
      due_at: s.due_at,
      due_key: dueKey,
      overdue_days: Math.max(0, overdue),
      deep_link: s.deep_link,
      canonical_action: MYDAY_TYPE_ACTION[s.type] ?? s.authorized_actions[0] ?? null,
      inline_completable: false,
      blocker,
      carried_from: null,
      recurrence: null,
      evidence: null,
      version: 0,
      source: {
        module: MYDAY_TYPE_MODULE[s.type] ?? s.source.workflow,
        resource_type: null,
        resource_id: null,
        workflow: s.source.workflow,
        version: s.source.version,
        ref_id: s.source.ref_id,
      },
      can_dismiss: true,
      can_snooze: true,
    };
    item.group = myDayGroupOf({
      status: item.status,
      origin: item.origin,
      source_group: s.source_group,
      overdue_days: item.overdue_days,
      due_key: item.due_key,
      today_key: today,
      week_end_key: weekEndKey,
    });
    if (hiddenItemKeys.has(s.id)) {
      hidden.push(item);
      continue;
    }
    items.push(item);
  }

  items.sort(myDayCompareItems);
  hidden.sort(myDayCompareItems);

  const visible = items.filter((i) => i.status !== "dismissed" && i.status !== "snoozed");
  const attention = visible.filter((i) => i.group === "attention").length;
  const dueToday = visible.filter((i) => i.group === "today").length;
  const inProgress = visible.filter((i) => i.group === "in_progress").length;
  const waiting = visible.filter((i) => i.group === "waiting").length;
  const completedToday = visible.filter((i) => i.group === "completed" && i.evidence?.at != null && myDayDateKey(i.evidence.at, offset) === today).length;
  const overdueCount = visible.filter((i) => i.overdue_days > 0 && i.status !== "done").length;
  const blockedCount = visible.filter((i) => i.status === "blocked" || (i.blocker != null && i.status !== "done")).length;

  const summary: MyDaySummary = {
    total_open: visible.filter((i) => i.group !== "completed").length,
    attention,
    due_today: dueToday,
    in_progress: inProgress,
    waiting,
    completed_today: completedToday,
    overdue_count: overdueCount,
    blocked_count: blockedCount,
  };

  const personalDone = inputs.personal.filter((p) => p.completed_at != null).map((p) => ({ date: p.completed_at! }));
  const instanceDone = inputs.instances.filter((r) => r.completed_at != null).map((r) => ({ date: r.completed_at! }));
  const analytics = myDayAnalyticsFor(visible, personalDone, instanceDone, today, offset);

  return {
    ok: true,
    role: inputs.caller.role,
    name: inputs.caller.name,
    job_title: inputs.caller.job_title,
    department: inputs.caller.department,
    generated_at: now,
    server_time: now,
    tz_offset_minutes: offset,
    today_date: today,
    view,
    summary,
    badge: attention + dueToday,
    groups: MYDAY_GROUP_ORDER,
    items,
    dismissed_items: hidden,
    analytics,
    prefs: inputs.prefs,
    personal_count: inputs.personal.filter((p) => !p.recurrence).length,
    routine_count: inputs.instances.length,
  };
}
