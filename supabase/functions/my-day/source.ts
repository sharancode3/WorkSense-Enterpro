import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { notifyScanAfter } from "../_shared/notify-hook.ts";
import { computeReviewIndex } from "../_shared/workforce-review-index.ts";
import { buildMyWork, type MyWorkResult, type TaskRow, type TwinRow } from "../_shared/my-work-engine.ts";
import {
  buildMyDay,
  myDayAddDays,
  myDayDateKey,
  myDayLocalToIso,
  myDaySourceMetaForType,
  myDayStartOfDay,
  type MyDayBlocker,
  type MyDayInputs,
  type MyDayInstanceRow,
  type MyDayPersonalRow,
  type MyDayPrefs,
  type MyDayResult,
  type MyDaySourceItem,
  type MyDayView,
} from "../_shared/my-day-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildTeamMemberIds(allTwins: { id: string; manager_id: string | null }[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const t of allTwins) {
    if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
  }
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of children.get(cur) ?? []) stack.push(c);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Per-role SYSTEM routines (deterministic, code-defined). Instances are
// materialized idempotently per (org, owner, rule_key, occurrence_date).
// ---------------------------------------------------------------------------

interface SystemRoutineDef {
  key: string;
  title: string;
  freq: "daily" | "weekly";
  weekdays: number[]; // 0=Sunday..6=Saturday (only for weekly)
  day_time: string; // local clock "HH:MM"
  module: string;
  action: string;
  link: string;
  notes: string;
}

function systemRoutinesFor(role: string): SystemRoutineDef[] {
  switch (role) {
    case "employee":
      return [
        { key: "system:onboarding:review", title: "Review your onboarding & development next steps", freq: "daily", weekdays: [], day_time: "09:00", module: "onboarding", action: "review", link: "/onboarding", notes: "A short daily scan of what is ready for you." },
        { key: "system:skills:refresh", title: "Refresh your skill graph with recent work", freq: "weekly", weekdays: [1], day_time: "10:00", module: "skill_data", action: "update", link: "/graph", notes: "Weekly check that your skills reflect recent work." },
      ];
    case "manager":
      return [
        { key: "system:team:approvals", title: "Clear team approvals & requests", freq: "daily", weekdays: [], day_time: "08:30", module: "recommendations", action: "approve", link: "/hub", notes: "Review requests waiting on you from your team." },
        { key: "system:team:checkin", title: "Weekly 1:1 check-in on team signals", freq: "weekly", weekdays: [3], day_time: "11:00", module: "workforce_review", action: "review", link: "/workforce", notes: "A rhythm of short, regular check-ins." },
      ];
    case "hr_executive":
      return [
        { key: "system:gov:pending", title: "Governance & pending decisions", freq: "daily", weekdays: [], day_time: "08:30", module: "admin", action: "review", link: "/app", notes: "Daily governance sweep of pending decisions and blockers." },
        { key: "system:org:health", title: "Weekly workforce & data-quality review", freq: "weekly", weekdays: [5], day_time: "09:00", module: "workforce_review", action: "review", link: "/workforce/data-quality", notes: "Weekly signal and data-quality review across the org." },
      ];
    case "hr_partner":
      return [
        { key: "system:hr:approvals", title: "Process pending approvals", freq: "daily", weekdays: [], day_time: "08:30", module: "recommendations", action: "approve", link: "/hub", notes: "Clear the approval queue for your scope." },
        { key: "system:hr:signals", title: "Review workforce signals for your scope", freq: "weekly", weekdays: [4], day_time: "10:00", module: "workforce_review", action: "review", link: "/workforce", notes: "Weekly scan of review signals." },
      ];
    case "recruiter":
      return [
        { key: "system:rec:pipeline", title: "Advance candidates in the pipeline", freq: "daily", weekdays: [], day_time: "09:00", module: "recruitment", action: "advance", link: "/recruitment", notes: "Daily pipeline sweep — invites, scorecards, decisions." },
        { key: "system:rec:assessments", title: "Review submitted assessments & scorecards", freq: "weekly", weekdays: [2], day_time: "14:00", module: "recruitment", action: "review", link: "/recruitment", notes: "Weekly review of submitted work samples and interviews." },
      ];
    case "it_security":
      return [
        { key: "system:it:provisioning", title: "Process provisioning handoffs", freq: "daily", weekdays: [], day_time: "09:00", module: "access", action: "provision", link: "/onboarding", notes: "Daily provisioning handoff sweep for new starters." },
        { key: "system:it:audit", title: "Weekly access review audit", freq: "weekly", weekdays: [5], day_time: "15:00", module: "access", action: "audit", link: "/admin/access", notes: "Weekly access review pass." },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Recurrence helpers
// ---------------------------------------------------------------------------

function occurrenceDateKeys(fromKey: string, def: { freq: "daily" | "weekly"; weekdays: number[] }, windowDays: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const key = myDayAddDays(fromKey, i);
    if (def.freq === "daily") {
      out.push(key);
    } else {
      const dow = new Date(`${key}T00:00:00.000Z`).getUTCDay();
      if (def.weekdays.includes(dow)) out.push(key);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Projection loader — mirrors the my-work function's role-scoped build so My
// Day and My Work always agree about what the caller may see.
// ---------------------------------------------------------------------------

async function loadProjection(supabase, caller: { id: string; role: string; org_id: string }) {
  const orgId = caller.org_id;
  const [twinsRes, plansRes, tasksRes, recsRes, tasks2Res, appsRes, reqsRes, sessRes, assertRes] = await Promise.all([
    supabase.from("digital_twins").select("id, name, role, status, manager_id, signals, attendance, delivery, promotion_lag_months").eq("org_id", orgId),
    supabase.from("onboarding_plans").select("id, twin_id, version, status").eq("org_id", orgId).not("status", "eq", "superseded"),
    supabase.from("onboarding_tasks").select("plan_id, twin_id, task_code, title, task_type, owner_role, state, due_date, blockers").eq("org_id", orgId),
    supabase.from("recommendations").select("id, twin_id, category, urgency, status, required_signoff_role, version").eq("org_id", orgId),
    supabase.from("action_tasks").select("id, recommendation_id, owner_twin_id, owner_role, title, status, due_at").eq("org_id", orgId),
    supabase.from("applications").select("candidate_twin_id, requisition_id, stage, applied_at").eq("org_id", orgId),
    supabase.from("job_requisitions").select("id, title, department, status").eq("org_id", orgId),
    supabase.from("candidate_sessions").select("id, twin_id, session_type, status, expires_at").eq("org_id", orgId),
    supabase.from("skill_assertions").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("review_state", ["claimed", "extracted"]),
  ]);

  const twins = (twinsRes.data ?? []) as (TwinRow & { signals?: unknown; attendance?: unknown; delivery?: unknown; promotion_lag_months?: number })[];
  const scopeIsOrg = caller.role === "hr_executive" || caller.role === "hr_partner";
  const teamIds = scopeIsOrg ? null : buildTeamMemberIds(twins, caller.id);
  const scopedTwins = twins.filter(
    (t) => t.status === "active" && ["employee", "manager"].includes(t.role) && (scopeIsOrg || teamIds!.has(t.id))
  );
  const scopedIds = new Set(scopedTwins.map((t) => t.id));
  const { data: obsRows } =
    scopedIds.size > 0
      ? await supabase
          .from("workforce_observations")
          .select("twin_id, metric, period_start, value, missing")
          .eq("org_id", orgId)
          .in("twin_id", [...scopedIds])
      : { data: [] };
  const obsByTwin = new Map<string, { metric: string; period: string; value: number | null; missing: boolean }[]>();
  for (const o of obsRows ?? []) {
    const row = { metric: o.metric, period: String(o.period_start).slice(0, 7), value: typeof o.value === "number" ? o.value : null, missing: o.missing === true };
    obsByTwin.set(o.twin_id, [...(obsByTwin.get(o.twin_id) ?? []), row]);
  }
  const reviewCases = scopedTwins.map((t) => {
    const signals = (t.signals ?? []) as { type?: string; value?: unknown }[];
    const seeks = signals.some((s) => s.type === "seeks_growth" && s.value === true);
    const r = computeReviewIndex({
      twin_id: t.id,
      promotion_lag_months: t.promotion_lag_months ?? 0,
      attendance: (t.attendance ?? {}) as { baseline?: number; recent?: number },
      delivery: (t.delivery ?? {}) as { missed?: number; total?: number },
      observations: obsByTwin.get(t.id) ?? [],
      seeks_growth: seeks,
    });
    return { twin_id: t.id, name: t.name, index: r.index, priority: r.priority };
  });

  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const planIdToTwin = new Map<string, string>();
  for (const p of plansRes.data ?? []) planIdToTwin.set((p as { id: string }).id, (p as { twin_id: string }).twin_id);
  const tasksWithTwin = tasks.map((t) => ({ ...t, twin_id: t.twin_id ?? planIdToTwin.get(t.plan_id) ?? "" }));

  const work = buildMyWork(
    {
      caller: { id: caller.id, role: caller.role, org_id: orgId },
      twins,
      plans: (plansRes.data ?? []) as never,
      tasks: tasksWithTwin,
      recommendations: (recsRes.data ?? []) as never,
      actionTasks: (tasks2Res.data ?? []) as never,
      applications: (appsRes.data ?? []) as never,
      requisitions: (reqsRes.data ?? []) as never,
      sessions: (sessRes.data ?? []) as never,
      reviewCases,
      unverifiedClaims: assertRes.count ?? 0,
    },
    new Date().toISOString()
  );

  return { work, twins, tasks: tasksWithTwin };
}

/** Richer blocker details for onboarding tasks with open blockers. */
function buildBlockerDetails(
  tasks: { plan_id: string; twin_id: string; task_code: string; owner_role: string; title: string; blockers?: { id?: string; note?: string; reported_by?: string; at?: string; status?: string }[] | null }[],
  twins: { id: string; name: string }[]
): { [itemKey: string]: MyDayBlocker } {
  const nameByTwin = new Map(twins.map((t) => [t.id, t.name]));
  const out: { [itemKey: string]: MyDayBlocker } = {};
  for (const t of tasks) {
    const open = (t.blockers ?? []).filter((b) => b.status === "open");
    if (open.length === 0) continue;
    const ownerLabel = open.map((b) => {
      const who = b.reported_by ?? "";
      return nameByTwin.get(who) ?? (who || "Reported");
    }).join(", ");
    const recordedAt = open.map((b) => b.at ?? "").filter(Boolean).sort().pop() ?? null;
    const key = `${t.owner_role === "it_security" ? "provisioning" : "onboarding"}:${t.plan_id}:${t.task_code}`;
    out[key] = {
      reason: open.map((b) => b.note ?? "blocker reported").join("; ") || "Open blocker",
      owner_label: ownerLabel,
      recorded_at: recordedAt,
      next_action: "Resolve or reassign in the onboarding center",
      downstream_impact: "Stalls the onboarding journey",
    };
  }
  return out;
}

function toSourceItem(w: MyWorkResult["items"][number]): MyDaySourceItem {
  return {
    id: w.id,
    type: w.type,
    title: w.title,
    subject: w.subject,
    subject_id: w.subject_id,
    owner_label: w.owner_label,
    source_group: w.group,
    authorized_actions: w.authorized_actions,
    status_label: w.status_label,
    due_at: w.due_at,
    priority_reason: w.priority_reason,
    blocker: w.blocker,
    source: w.source,
    deep_link: w.deep_link,
  };
}

// ---------------------------------------------------------------------------
// Instance maintenance
// ---------------------------------------------------------------------------

async function ensureSystemInstances(supabase, twin: { id: string; org_id: string; role: string }, todayKey: string, offset: number): Promise<void> {
  const defs = systemRoutinesFor(twin.role);
  if (defs.length === 0) return;
  const rows = defs.flatMap((def) =>
    occurrenceDateKeys(todayKey, def, 7).map((dateKey) => ({
      org_id: twin.org_id,
      owner_twin_id: twin.id,
      rule_type: "system" as const,
      rule_key: def.key,
      freq: def.freq,
      occurrence_date: dateKey,
      due_at: myDayLocalToIso(dateKey, def.day_time, offset),
      title: def.title,
      notes: def.notes,
      source_module: def.module,
      canonical_action: def.action,
      deep_link: def.link,
      status: "todo",
    }))
  );
  const { error } = await supabase.from("myday_recurrence_instances").upsert(rows, { onConflict: "org_id,owner_twin_id,rule_key,occurrence_date" });
  if (error) throw new Error(`myday system routine upsert: ${error.message}`);
}

async function ensurePersonalInstances(supabase, twin: { id: string; org_id: string }, todayKey: string, offset: number): Promise<void> {
  const { data: tasks, error } = await supabase
    .from("myday_personal_tasks")
    .select("id, title, recurrence, source_module, source_resource_type, source_resource_id, canonical_action, deep_link")
    .eq("org_id", twin.org_id)
    .eq("owner_twin_id", twin.id)
    .neq("status", "done")
    .neq("status", "dismissed");
  if (error) throw new Error(`myday personal recurrence load: ${error.message}`);
  const rows = [];
  for (const t of tasks ?? []) {
    const rec = t.recurrence as { freq?: "daily" | "weekly"; weekdays?: number[]; day_time?: string | null } | null;
    if (!rec?.freq) continue;
    const def = { freq: rec.freq === "weekly" ? ("weekly" as const) : ("daily" as const), weekdays: Array.isArray(rec.weekdays) ? rec.weekdays : [] };
    const dayTime = typeof rec.day_time === "string" && rec.day_time.length === 5 ? rec.day_time : "09:00";
    for (const dateKey of occurrenceDateKeys(todayKey, def, 14)) {
      rows.push({
        org_id: twin.org_id,
        owner_twin_id: twin.id,
        rule_type: "personal",
        rule_key: `personal:${t.id}`,
        freq: def.freq,
        occurrence_date: dateKey,
        due_at: myDayLocalToIso(dateKey, dayTime, offset),
        title: t.title,
        notes: null,
        source_module: t.source_module,
        source_resource_type: t.source_resource_type,
        source_resource_id: t.source_resource_id,
        canonical_action: t.canonical_action,
        deep_link: t.deep_link,
        status: "todo",
      });
    }
  }
  if (rows.length === 0) return;
  const { error: insErr } = await supabase.from("myday_recurrence_instances").upsert(rows, { onConflict: "org_id,owner_twin_id,rule_key,occurrence_date" });
  if (insErr) throw new Error(`myday personal instance upsert: ${insErr.message}`);
}

/** Missed routines older than yesterday auto-dismiss (kept for yesterday = "Missed"). */
async function sweepStaleInstances(supabase, twin: { id: string; org_id: string }, todayKey: string): Promise<void> {
  const staleBefore = myDayAddDays(todayKey, -1);
  await supabase
    .from("myday_recurrence_instances")
    .update({ status: "dismissed", updated_at: new Date().toISOString(), version: 0 })
    .eq("org_id", twin.org_id)
    .eq("owner_twin_id", twin.id)
    .lt("occurrence_date", staleBefore)
    .in("status", ["todo", "in_progress"]);
}

/** Optional personal rollover: overdue one-off personal tasks carry to today. */
async function applyRollover(supabase, twin: { id: string; org_id: string }, prefs: MyDayPrefs, todayKey: string, offset: number): Promise<void> {
  if (!prefs.rollover_enabled) return;
  const startToday = new Date(myDayStartOfDay(todayKey, offset)).toISOString();
  const { data: rows, error } = await supabase
    .from("myday_personal_tasks")
    .select("id, due_at, original_due_at, rollover_count, status")
    .eq("org_id", twin.org_id)
    .eq("owner_twin_id", twin.id)
    .is("recurrence", null)
    .in("status", ["todo", "in_progress", "blocked", "waiting"])
    .lt("due_at", startToday);
  if (error) throw new Error(`myday rollover load: ${error.message}`);
  for (const r of rows ?? []) {
    await supabase
      .from("myday_personal_tasks")
      .update({
        due_at: startToday,
        original_due_at: r.original_due_at ?? r.due_at,
        rollover_count: (r.rollover_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
        version: (r.version ?? 1) + 1,
      })
      .eq("id", r.id)
      .eq("org_id", twin.org_id)
      .eq("owner_twin_id", twin.id);
  }
}

// ---------------------------------------------------------------------------
// Main build (get / summary / post-action refresh)
// ---------------------------------------------------------------------------

async function buildResult(
  supabase,
  caller: { id: string; role: string; org_id: string; name: string; job_title: string | null; department: string | null },
  view: MyDayView,
  tzOffsetMinutes: number
): Promise<MyDayResult> {
  const now = new Date().toISOString();
  const todayKey = myDayDateKey(now, tzOffsetMinutes);

  // Prefs (create default row on first visit).
  const { data: prefsRow } = await supabase.from("myday_prefs").select("*").eq("twin_id", caller.id).maybeSingle();
  const prefs: MyDayPrefs = prefsRow
    ? { rollover_enabled: prefsRow.rollover_enabled !== false, workday_start_hour: typeof prefsRow.workday_start_hour === "number" ? prefsRow.workday_start_hour : 9 }
    : { rollover_enabled: true, workday_start_hour: 9 };
  if (!prefsRow) {
    const { error } = await supabase.from("myday_prefs").insert({ twin_id: caller.id, org_id: caller.org_id, rollover_enabled: true, workday_start_hour: 9 });
    if (error) throw new Error(`myday prefs insert: ${error.message}`);
  }

  await ensureSystemInstances(supabase, caller, todayKey, tzOffsetMinutes);
  await sweepStaleInstances(supabase, caller, todayKey);
  await applyRollover(supabase, caller, prefs, todayKey, tzOffsetMinutes);
  await ensurePersonalInstances(supabase, caller, todayKey, tzOffsetMinutes);

  const { work, twins, tasks } = await loadProjection(supabase, caller);
  const blockerDetails = buildBlockerDetails(tasks, twins);

  const [personalRes, instancesRes, itemStateRes] = await Promise.all([
    supabase.from("myday_personal_tasks").select("*").eq("org_id", caller.org_id).eq("owner_twin_id", caller.id).order("created_at", { ascending: false }),
    supabase.from("myday_recurrence_instances").select("*").eq("org_id", caller.org_id).eq("owner_twin_id", caller.id).gte("occurrence_date", myDayAddDays(todayKey, -1)),
    supabase.from("myday_item_state").select("*").eq("org_id", caller.org_id).eq("owner_twin_id", caller.id),
  ]);

  const personal = (personalRes.data ?? []) as MyDayPersonalRow[];
  const instances = (instancesRes.data ?? []) as MyDayInstanceRow[];
  const itemStates = itemStateRes.data ?? [];

  // Hidden source items = local dismiss / active snooze (myday_item_state).
  // They stay in the projection so the engine can surface them for undo.
  const nowMs = Date.parse(now);
  const hiddenKeys = (itemStates as { item_key: string; state: string; snoozed_until?: string | null }[])
    .filter(
      (st) => st.state === "dismissed" || (st.state === "snoozed" && st.snoozed_until != null && Date.parse(st.snoozed_until) > nowMs)
    )
    .map((st) => st.item_key);
  const sourceItems = work.items.map(toSourceItem);

  const inputs: MyDayInputs = {
    caller,
    sourceItems,
    personal,
    instances,
    prefs,
    blockerDetails,
    hiddenItemKeys: hiddenKeys,
    now,
    tzOffsetMinutes,
  };

  return buildMyDay(inputs, view);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, org_id, name, job_title, department")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }

  const action = typeof body.action === "string" ? body.action : "get";
  const tzOffsetMinutes = typeof body.tz_offset_minutes === "number" ? Math.round(body.tz_offset_minutes) : 0;
  const view: MyDayView = body.view === "week" ? "week" : body.view === "all" ? "all" : "today";

  try {
    if (action === "get" || action === "summary") {
      const result = await buildResult(supabase, caller, view, tzOffsetMinutes);
      if (action === "summary") {
        return json({ ok: true, badge: result.badge, summary: result.summary, role: result.role, generated_at: result.generated_at, today_date: result.today_date, tz_offset_minutes: result.tz_offset_minutes });
      }
      return json(result);
    }

    if (action === "update_prefs") {
      const rollover_enabled = typeof body.rollover_enabled === "boolean" ? body.rollover_enabled : undefined;
      const workday_start_hour = typeof body.workday_start_hour === "number" ? Math.round(body.workday_start_hour) : undefined;
      if (workday_start_hour !== undefined && (workday_start_hour < 0 || workday_start_hour > 23)) {
        return json({ error: "INVALID_PREFS", message: "workday_start_hour must be between 0 and 23." }, 400);
      }
      const { error } = await supabase.from("myday_prefs").upsert({
        twin_id: caller.id,
        org_id: caller.org_id,
        rollover_enabled: rollover_enabled ?? true,
        workday_start_hour: workday_start_hour ?? 9,
        updated_at: new Date().toISOString(),
      }, { onConflict: "twin_id" });
      if (error) throw new Error(`myday prefs update: ${error.message}`);
      const result = await buildResult(supabase, caller, view, tzOffsetMinutes);
      return json({ ok: true, result });
    }

    if (action === "create_task") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (title.length === 0 || title.length > 200) return json({ error: "INVALID_TITLE", message: "Title is required (max 200 chars)." }, 400);
      const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null;
      const dueAt = typeof body.due_at === "string" && body.due_at ? body.due_at : null;
      if (dueAt != null && Number.isNaN(Date.parse(dueAt))) return json({ error: "INVALID_DUE", message: "due_at must be an ISO timestamp." }, 400);

      let recurrence: { freq: "daily" | "weekly"; weekdays: number[]; day_time: string | null } | null = null;
      if (body.recurrence && typeof body.recurrence === "object") {
        const rec = body.recurrence as { freq?: string; weekdays?: unknown; day_time?: unknown };
        if (rec.freq !== "daily" && rec.freq !== "weekly") return json({ error: "INVALID_RECURRENCE", message: "recurrence.freq must be daily or weekly." }, 400);
        const weekdays = Array.isArray(rec.weekdays) ? rec.weekdays.filter((w): w is number => typeof w === "number" && w >= 0 && w <= 6) : [];
        const dayTime = typeof rec.day_time === "string" && /^\d{2}:\d{2}$/.test(rec.day_time) ? rec.day_time : "09:00";
        recurrence = { freq: rec.freq, weekdays, day_time: dayTime };
      }

      // Optional association to a canonical record the caller can already see
      // (validated against the caller's own projection below).
      let assoc: { module: string | null; resource_type: string | null; resource_id: string | null; canonical_action: string | null; deep_link: string | null } | null = null;
      const assocItemId = typeof body.assoc_item_id === "string" ? body.assoc_item_id : null;
      if (assocItemId) {
        const proj = await loadProjection(supabase, caller);
        const match = proj.work.items.find((i) => i.id === assocItemId);
        if (!match) return json({ error: "ASSOC_FORBIDDEN", message: "The selected work item is not in your scope." }, 403);
        const meta = myDaySourceMetaForType(match.type);
        assoc = { module: meta.module, resource_type: "source_item", resource_id: match.id, canonical_action: meta.action, deep_link: match.deep_link };
      }

      const { data: row, error } = await supabase
        .from("myday_personal_tasks")
        .insert({
          org_id: caller.org_id,
          owner_twin_id: caller.id,
          title,
          notes,
          due_at: dueAt,
          recurrence,
          status: "todo",
          source_module: assoc?.module ?? null,
          source_resource_type: assoc?.resource_type ?? null,
          source_resource_id: assoc?.resource_id ?? null,
          canonical_action: assoc?.canonical_action ?? null,
          deep_link: assoc?.deep_link ?? null,
          version: 1,
        })
        .select("id")
        .single();
      if (error || !row) throw new Error(`myday create task: ${error?.message}`);
      const result = await buildResult(supabase, caller, view, tzOffsetMinutes);
      void notifyScanAfter(caller.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      return json({ ok: true, created_id: row.id, result });
    }

    if (action === "transition") {
      const target = typeof body.target === "string" ? body.target : "";
      const key = typeof body.key === "string" ? body.key : "";
      const to = typeof body.to === "string" ? body.to : "";
      const version = typeof body.version === "number" ? body.version : null;
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;
      const snoozeUntil = typeof body.snooze_until === "string" && body.snooze_until ? body.snooze_until : null;
      if (!key || !to) return json({ error: "INVALID_TRANSITION", message: "target, key and to are required." }, 400);

      const ALLOWED = ["todo", "in_progress", "waiting", "blocked", "done", "dismissed", "snoozed"];
      if (!ALLOWED.includes(to)) return json({ error: "INVALID_STATE", message: `Unknown state ${to}.` }, 400);
      if (snoozeUntil != null && Number.isNaN(Date.parse(snoozeUntil))) return json({ error: "INVALID_SNOOZE", message: "snooze_until must be an ISO timestamp." }, 400);
      if ((to === "blocked" || to === "waiting") && !note) return json({ error: "REASON_REQUIRED", message: `A short note is required when marking an item ${to}.` }, 400);
      if (to === "snoozed" && !snoozeUntil) return json({ error: "SNOOZE_UNTIL_REQUIRED", message: "snooze_until is required when snoozing." }, 400);

      if (target === "personal" || target === "instance") {
        const table = target === "personal" ? "myday_personal_tasks" : "myday_recurrence_instances";
        const idMatch = key.match(target === "personal" ? /^personal:(.+)$/ : /^routine:(.+)$/);
        if (!idMatch || !uuidRe.test(idMatch[1])) return json({ error: "NOT_FOUND", message: "Unknown item." }, 404);
        const { data: row } = await supabase.from(table).select("*").eq("id", idMatch[1]).eq("org_id", caller.org_id).eq("owner_twin_id", caller.id).maybeSingle();
        if (!row) return json({ error: "NOT_FOUND", message: "Unknown item." }, 404);
        if (version != null && row.version !== version) return json({ error: "VERSION_CONFLICT", message: "This item changed in another window — refresh and try again." }, 409);
        if (row.status === to) return json({ ok: true, already: true, version: row.version });

        const patch: Record<string, unknown> = { status: to, version: (row.version ?? 1) + 1, updated_at: new Date().toISOString() };
        if (to === "done") {
          patch.completed_at = new Date().toISOString();
          patch.completion_evidence = note;
          patch.snoozed_until = null;
          patch.state_note = null;
        } else if (to === "blocked" || to === "waiting") {
          patch.state_note = note;
          patch.snoozed_until = null;
          patch.completed_at = null;
          patch.completion_evidence = null;
        } else if (to === "snoozed") {
          patch.snoozed_until = snoozeUntil;
          patch.state_note = note;
          patch.completed_at = null;
          patch.completion_evidence = null;
        } else {
          patch.snoozed_until = null;
          patch.state_note = null;
          if (to === "todo") {
            patch.completed_at = null;
            patch.completion_evidence = null;
          }
        }
        const { data: updated, error } = await supabase.from(table).update(patch).eq("id", row.id).eq("org_id", caller.org_id).eq("owner_twin_id", caller.id).eq("version", row.version).select("id").single();
        if (error || !updated) return json({ error: "VERSION_CONFLICT", message: "This item changed in another window — refresh and try again." }, 409);
        const result = await buildResult(supabase, caller, view, tzOffsetMinutes);
        void notifyScanAfter(caller.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        return json({ ok: true, transitioned: { key, to }, result });
      }

      if (target === "source") {
        if (to === "todo") {
          await supabase.from("myday_item_state").delete().eq("org_id", caller.org_id).eq("owner_twin_id", caller.id).eq("item_key", key);
          const result = await buildResult(supabase, caller, view, tzOffsetMinutes);
          return json({ ok: true, transitioned: { key, to }, result });
        }
        if (to !== "dismissed" && to !== "snoozed") {
          return json({ error: "SOURCE_NO_INLINE", message: "Workflow items complete inside their own center — open the linked record to act on it." }, 400);
        }
        if (to === "snoozed" && !snoozeUntil) return json({ error: "SNOOZE_UNTIL_REQUIRED", message: "snooze_until is required when snoozing." }, 400);
        const { error } = await supabase.from("myday_item_state").upsert(
          { org_id: caller.org_id, owner_twin_id: caller.id, item_key: key, state: to, snoozed_until: to === "snoozed" ? snoozeUntil : null, note, updated_at: new Date().toISOString() },
          { onConflict: "org_id,owner_twin_id,item_key" }
        );
        if (error) throw new Error(`myday item state upsert: ${error.message}`);
        const result = await buildResult(supabase, caller, view, tzOffsetMinutes);
        void notifyScanAfter(caller.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        return json({ ok: true, transitioned: { key, to }, result });
      }

      return json({ error: "INVALID_TARGET", message: "target must be personal, instance or source." }, 400);
    }

    return json({ error: "UNKNOWN_ACTION", message: `Unknown action ${action}.` }, 400);
  } catch (err) {
    console.error("my-day failed:", err);
    return json({ error: "INTERNAL", message: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
