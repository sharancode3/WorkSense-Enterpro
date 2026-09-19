import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  notifBuildDigest,
  notifDateKey,
  notifFilterByPrefs,
  notifRules,
  notifWorkflowAnalytics,
  type NotifDigestItem,
  type NotifInputs,
  type NotifPrefsRow,
} from "../_shared/notification-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DEFAULT_PREFS = {
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
  working_days: [1, 2, 3, 4, 5] as number[],
};

function buildTeamIds(twins: { id: string; manager_id: string | null }[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const t of twins) if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
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

async function loadCanonical(supabase, orgId: string, includePersonalForTwin: string | null): Promise<NotifInputs> {
  const [twinsRes, plansRes, tasksRes, appsRes, reqsRes, sessRes, assRes, recsRes, atRes, casesRes, revActionsRes, staffingRes, policyRes, escRes, assertRes, adminRes] = await Promise.all([
    supabase.from("digital_twins").select("id, name, role, status, manager_id").eq("org_id", orgId),
    supabase.from("onboarding_plans").select("id, twin_id, version, status, start_date").eq("org_id", orgId),
    supabase.from("onboarding_tasks").select("plan_id, twin_id, task_code, title, task_type, owner_role, state, due_date, blockers, completion_record").eq("org_id", orgId),
    supabase.from("applications").select("candidate_twin_id, requisition_id, stage, applied_at, version").eq("org_id", orgId),
    supabase.from("job_requisitions").select("id, title, department, status").eq("org_id", orgId),
    supabase.from("candidate_sessions").select("id, twin_id, session_type, status, expires_at").eq("org_id", orgId),
    supabase.from("assessments").select("id, twin_id, requisition_id, type, result, reviewed_at").eq("org_id", orgId),
    supabase.from("recommendations").select("id, twin_id, category, urgency, status, version, required_signoff_role").eq("org_id", orgId),
    supabase.from("action_tasks").select("id, recommendation_id, owner_twin_id, owner_role, title, status, due_at, task_code, started_at, completed_at").eq("org_id", orgId),
    supabase.from("workforce_review_cases").select("twin_id, index, priority").eq("org_id", orgId),
    supabase.from("review_case_actions").select("case_id, twin_id, action, acted_by, acted_at").eq("org_id", orgId),
    supabase.from("staffing_proposals").select("id, status, title").eq("org_id", orgId),
    supabase.from("policy_documents").select("doc_code, title, version, effective_from").eq("org_id", orgId),
    supabase.from("policy_escalations").select("id, status, question, owner_twin_id, created_at").eq("org_id", orgId),
    supabase.from("skill_assertions").select("id, twin_id, review_state").eq("org_id", orgId).in("review_state", ["claimed", "extracted"]),
    supabase.from("admin_actions").select("id, action, actor_twin_id, target_twin_id, created_at, reason").eq("org_id", orgId),
  ]);

  let personal: unknown[] = [];
  let instances: unknown[] = [];
  if (includePersonalForTwin) {
    const [p, i] = await Promise.all([
      supabase.from("myday_personal_tasks").select("id, owner_twin_id, title, due_at, status, recurrence, original_due_at, rollover_count").eq("org_id", orgId).eq("owner_twin_id", includePersonalForTwin),
      supabase.from("myday_recurrence_instances").select("id, owner_twin_id, rule_key, occurrence_date, due_at, title, status").eq("org_id", orgId).eq("owner_twin_id", includePersonalForTwin),
    ]);
    personal = p.data ?? [];
    instances = i.data ?? [];
  }

  return {
    org_id: orgId,
    twins: (twinsRes.data ?? []) as never,
    plans: (plansRes.data ?? []) as never,
    tasks: ((tasksRes.data ?? []).map((t) => ({
      ...t,
      twin_id: (t.twin_id as string | null) ?? (plansRes.data ?? []).find((p) => (p as { id: string }).id === t.plan_id)?.twin_id ?? "",
      completion_at: (t.completion_record as { at?: string } | null)?.at ?? null,
    }))) as never,
    applications: (appsRes.data ?? []) as never,
    requisitions: (reqsRes.data ?? []) as never,
    sessions: (sessRes.data ?? []) as never,
    assessments: (assRes.data ?? []) as never,
    recommendations: (recsRes.data ?? []) as never,
    actionTasks: (atRes.data ?? []) as never,
    reviewCases: (casesRes.data ?? []) as never,
    reviewActions: (revActionsRes.data ?? []) as never,
    staffingProposals: (staffingRes.data ?? []) as never,
    policyDocs: (policyRes.data ?? []) as never,
    escalations: (escRes.data ?? []) as never,
    assertions: (assertRes.data ?? []) as never,
    adminActions: (adminRes.data ?? []) as never,
    personalTasks: personal as never,
    instances: instances as never,
    prefs: [],
  };
}

async function audit(supabase, orgId: string, recipient: string, notificationId: string | null, eventType: string, detail: Record<string, unknown>) {
  await supabase.from("notification_events").insert({
    org_id: orgId,
    recipient_twin_id: recipient,
    notification_id: notificationId,
    event_type: eventType,
    detail,
  }).then(() => undefined).catch(() => undefined);
}

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
    .select("id, role, org_id")
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
  const orgId = caller.org_id;
  const now = new Date().toISOString();
  const tzOffsetMinutes = typeof body.tz_offset_minutes === "number" ? Math.round(body.tz_offset_minutes) : 0;
  const todayKey = notifDateKey(now, tzOffsetMinutes);

  // supabase-js v2 requires a select/update/delete before filter chaining.

  try {
    // ---- Summary (badge) ---------------------------------------------------
    if (action === "summary") {
      const { data: rows } = await supabase.from("notifications").select("id, read_at, resolved_at, dismissed_at, action_required, severity, snoozed_until").eq("org_id", orgId).eq("recipient_twin_id", caller.id).is("read_at", null).limit(1000);
      const nowMs = Date.parse(now);
      const unread = (rows ?? []).filter((r) => !r.resolved_at && !r.dismissed_at && (!r.snoozed_until || Date.parse(r.snoozed_until) <= nowMs));
      const unreadTotal = unread.length;
      const unreadActionable = unread.filter((r) => r.action_required).length;
      const criticalUnread = unread.filter((r) => r.severity === "critical").length;
      return json({ ok: true, unread_total: unreadTotal, unread_actionable: unreadActionable, critical_unread: criticalUnread, role: caller.role, generated_at: now });
    }

    // ---- List ---------------------------------------------------------------
    if (action === "get") {
      const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 100) : 60;
      const { data: rows, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("org_id", orgId)
        .eq("recipient_twin_id", caller.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const { data: unreadRows } = await supabase.from("notifications").select("id, read_at, resolved_at, dismissed_at, action_required, severity, snoozed_until").eq("org_id", orgId).eq("recipient_twin_id", caller.id).is("read_at", null).limit(1000);
      const nowMs = Date.parse(now);
      const unread = (unreadRows ?? []).filter((r) => !r.resolved_at && !r.dismissed_at && (!r.snoozed_until || Date.parse(r.snoozed_until) <= nowMs));
      return json({
        ok: true,
        role: caller.role,
        generated_at: now,
        unread_total: unread.length,
        unread_actionable: unread.filter((r) => r.action_required).length,
        critical_unread: unread.filter((r) => r.severity === "critical").length,
        items: rows ?? [],
      });
    }

    // ---- Mark read / all read -----------------------------------------------
    if (action === "mark_read") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json({ error: "ID_REQUIRED" }, 400);
      const { data: row } = await supabase.from("notifications").select("id").eq("org_id", orgId).eq("recipient_twin_id", caller.id).eq("id", id).maybeSingle();
      if (!row) return json({ error: "NOT_FOUND" }, 404);
      await supabase.from("notifications").update({ read_at: now, updated_at: now }).eq("id", id).eq("org_id", orgId).eq("recipient_twin_id", caller.id);
      await audit(supabase, orgId, caller.id, id, "read", {});
      return json({ ok: true });
    }
    if (action === "mark_all_read") {
      const { data: unread } = await supabase.from("notifications").select("id").eq("org_id", orgId).eq("recipient_twin_id", caller.id).is("read_at", null).limit(1000);
      const ids = (unread ?? []).map((r) => r.id);
      if (ids.length > 0) {
        await supabase.from("notifications").update({ read_at: now, updated_at: now }).in("id", ids).eq("org_id", orgId).eq("recipient_twin_id", caller.id);
        await audit(supabase, orgId, caller.id, null, "read", { bulk: true, count: ids.length });
      }
      return json({ ok: true, marked: ids.length });
    }

    // ---- Snooze (never touches the source task due date) --------------------
    if (action === "snooze") {
      const id = typeof body.id === "string" ? body.id : "";
      const until = typeof body.snooze_until === "string" && body.snooze_until ? body.snooze_until : null;
      if (!id || !until || Number.isNaN(Date.parse(until))) return json({ error: "INVALID_SNOOZE", message: "id and snooze_until are required." }, 400);
      const { data: row } = await supabase.from("notifications").select("id").eq("org_id", orgId).eq("recipient_twin_id", caller.id).eq("id", id).maybeSingle();
      if (!row) return json({ error: "NOT_FOUND" }, 404);
      await supabase.from("notifications").update({ snoozed_until: until, updated_at: now }).eq("id", id).eq("org_id", orgId).eq("recipient_twin_id", caller.id);
      await audit(supabase, orgId, caller.id, id, "snoozed", { until });
      return json({ ok: true, snoozed_until: until });
    }

    // ---- Dismiss (informational only; mandatory work stays in My Day) -------
    if (action === "dismiss") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json({ error: "ID_REQUIRED" }, 400);
      const { data: row } = await supabase.from("notifications").select("id, action_required, severity, resolved_at, dismissed_at").eq("org_id", orgId).eq("recipient_twin_id", caller.id).eq("id", id).maybeSingle();
      if (!row) return json({ error: "NOT_FOUND" }, 404);
      if (row.action_required && !row.resolved_at && row.severity !== "informational") {
        return json({
          error: "MANDATORY_ACTION",
          message: "This notification reflects work you own — you can mark it read, but the action stays in My Day until resolved.",
        }, 400);
      }
      await supabase.from("notifications").update({ dismissed_at: now, updated_at: now }).eq("id", id).eq("org_id", orgId).eq("recipient_twin_id", caller.id);
      await audit(supabase, orgId, caller.id, id, "dismissed", {});
      return json({ ok: true });
    }

    // ---- Preferences ----------------------------------------------------------
    if (action === "prefs_get") {
      const { data: row } = await supabase.from("notification_preferences").select("*").eq("twin_id", caller.id).maybeSingle();
      return json({ ok: true, prefs: row ?? { twin_id: caller.id, org_id: orgId, ...DEFAULT_PREFS } });
    }
    if (action === "prefs_update" || action === "prefs_restore") {
      const allowed = ["assignments", "due_soon", "overdue", "status_updates", "personal_reminders", "daily_digest", "weekly_digest", "in_app", "quiet_hours_enabled"];
      const patch: Record<string, unknown> = { updated_at: now };
      if (action === "prefs_restore") {
        Object.assign(patch, DEFAULT_PREFS);
      } else {
        for (const key of allowed) {
          if (typeof body[key] === "boolean") patch[key] = body[key];
        }
        if (typeof body.quiet_hours_start === "string" && /^\d{2}:\d{2}$/.test(body.quiet_hours_start)) patch.quiet_hours_start = body.quiet_hours_start;
        if (typeof body.quiet_hours_end === "string" && /^\d{2}:\d{2}$/.test(body.quiet_hours_end)) patch.quiet_hours_end = body.quiet_hours_end;
        if (typeof body.timezone === "string" && body.timezone.length <= 64) patch.timezone = body.timezone;
        if (Array.isArray(body.working_days)) patch.working_days = body.working_days.filter((d) => typeof d === "number" && d >= 0 && d <= 6);
      }
      const { error } = await supabase.from("notification_preferences").upsert({ twin_id: caller.id, org_id: orgId, ...patch }, { onConflict: "twin_id" });
      if (error) throw error;
      await audit(supabase, orgId, caller.id, null, "prefs_changed", { keys: Object.keys(patch) });
      const { data: row } = await supabase.from("notification_preferences").select("*").eq("twin_id", caller.id).maybeSingle();
      return json({ ok: true, prefs: row ?? { twin_id: caller.id, org_id: orgId, ...DEFAULT_PREFS } });
    }

    // ---- Digest ----------------------------------------------------------------
    if (action === "digest") {
      const period = body.period === "weekly" ? "weekly" : "daily";
      const inputs = await loadCanonical(supabase, orgId, caller.id);
      const { data: prefsRow } = await supabase.from("notification_preferences").select("*").eq("twin_id", caller.id).maybeSingle();
      const prefs = prefsRow ?? { twin_id: caller.id, org_id: orgId, ...DEFAULT_PREFS };
      const drafts = notifFilterByPrefs(notifRules(inputs, now, todayKey), [prefs as NotifPrefsRow], now, tzOffsetMinutes);
      const mine = drafts.filter((d) => d.recipient_twin_id === caller.id);
      const items: NotifDigestItem[] = mine.map((d) => ({
        title: d.title,
        deep_link: d.deep_link,
        group: d.action_required ? "attention" : d.category === "deadline" ? "today" : "later",
        origin: d.source_module,
        status: "todo",
        due_key: d.deadline ? notifDateKey(d.deadline, tzOffsetMinutes) : null,
        priority_band: d.severity === "critical" ? "Critical" : d.severity === "high" ? "Due soon" : "Normal",
      }));
      const digest = notifBuildDigest(inputs, items, caller.role, period, now, todayKey, tzOffsetMinutes);
      await supabase.from("notification_digests").upsert(
        { org_id: orgId, twin_id: caller.id, period, period_key: digest.period_key, facts: digest.facts, generated_at: now },
        { onConflict: "org_id,twin_id,period,period_key" }
      ).then(() => undefined).catch(() => undefined);
      return json({ ok: true, digest });
    }

    // ---- Workflow analytics (role-scoped, honest) -----------------------------
    if (action === "analytics") {
      const inputs = await loadCanonical(supabase, orgId, caller.role === "employee" ? caller.id : null);
      const twins = inputs.twins as { id: string; manager_id: string | null; role: string; status: string }[];
      let scopeTwinIds: Set<string>;
      let scopeLabel: string;
      if (caller.role === "employee") {
        scopeTwinIds = new Set([caller.id]);
        scopeLabel = "personal";
      } else if (caller.role === "manager") {
        scopeTwinIds = buildTeamIds(twins, caller.id);
        scopeLabel = "team";
      } else {
        scopeTwinIds = new Set(twins.filter((t) => ["employee", "manager"].includes(t.role) && t.status === "active").map((t) => t.id));
        scopeLabel = caller.role === "hr_executive" || caller.role === "hr_partner" ? "org" : "org";
      }
      const analytics = notifWorkflowAnalytics(inputs, scopeTwinIds, caller.role, now, todayKey, tzOffsetMinutes);
      return json({ ok: true, analytics: { ...analytics, scope: scopeLabel } });
    }

    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (err) {
    console.error("notifications failed:", err);
    return json({ error: "INTERNAL", message: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
