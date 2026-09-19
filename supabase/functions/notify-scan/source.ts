import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  notifActiveConditions,
  notifDateKey,
  notifFilterByPrefs,
  notifRules,
  type NotifInputs,
  type NotifPrefsRow,
} from "../_shared/notification-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ---------------------------------------------------------------------------
// notify-scan — idempotent notification generator. Reads canonical domain
// records (authoritative state), evaluates the rule set, and materializes
// durable, deduplicated notifications. Repeated scans never duplicate rows.
// It also RESOLVES actionable notifications whose source condition is gone.
// ---------------------------------------------------------------------------

async function loadInputs(supabase, orgId: string) {
  const [twinsRes, plansRes, tasksRes, appsRes, reqsRes, sessRes, assRes, recsRes, atRes, casesRes, revActionsRes, staffingRes, policyRes, escRes, assertRes, adminRes, personalRes, instancesRes, prefsRes] = await Promise.all([
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
    supabase.from("myday_personal_tasks").select("id, owner_twin_id, title, due_at, status, recurrence, original_due_at, rollover_count").eq("org_id", orgId),
    supabase.from("myday_recurrence_instances").select("id, owner_twin_id, rule_key, occurrence_date, due_at, title, status").eq("org_id", orgId),
    supabase.from("notification_preferences").select("*").eq("org_id", orgId),
  ]);

  const inputs: NotifInputs = {
    org_id: orgId,
    twins: (twinsRes.data ?? []) as never,
    plans: (plansRes.data ?? []) as never,
    tasks: ((tasksRes.data ?? []).map((t) => ({
      ...t,
      // onboarding_tasks.twin_id may be null (seed inserts); derive from plan.
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
    personalTasks: (personalRes.data ?? []) as never,
    instances: (instancesRes.data ?? []) as never,
    prefs: (prefsRes.data ?? []) as never,
  };
  return inputs;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Authorization: the service role may run the scan on behalf of the system
  // (hooked into authoritative transitions); any authenticated user may also
  // trigger it (it only ever generates for authorized recipients).
  const authHeader = req.headers.get("Authorization") ?? "";
  let callerOrg: string | null = null;
  if (authHeader.replace("Bearer ", "") === serviceKey) {
    // system run — org resolved per payload below
  } else {
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);
    const { data: twin } = await supabase
      .from("digital_twins")
      .select("org_id")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (!twin) return json({ error: "UNAUTHENTICATED" }, 401);
    callerOrg = twin.org_id;
  }

  let body: { org_id?: string; tz_offset_minutes?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const orgId = callerOrg ?? body.org_id ?? "";
  if (!orgId) return json({ error: "ORG_REQUIRED", message: "org_id is required for a system run." }, 400);

  const now = new Date().toISOString();
  const tzOffsetMinutes = typeof body.tz_offset_minutes === "number" ? Math.round(body.tz_offset_minutes) : 0;
  const todayKey = notifDateKey(now, tzOffsetMinutes);

  try {
    const inputs = await loadInputs(supabase, orgId);
    const drafts = notifRules(inputs, now, todayKey);
    const filtered = notifFilterByPrefs(drafts, inputs.prefs as unknown as NotifPrefsRow[], now, tzOffsetMinutes);

    let created = 0;
    for (const d of filtered) {
      const { data, error } = await supabase.from("notifications").upsert(
        {
          org_id: orgId,
          recipient_twin_id: d.recipient_twin_id,
          category: d.category,
          severity: d.severity,
          type: d.type,
          title: d.title,
          body: d.body,
          actor_type: d.actor_type,
          actor_twin_id: d.actor_twin_id,
          actor_name: d.actor_name,
          related_twin_id: d.related_twin_id,
          related_name: d.related_name,
          source_module: d.source_module,
          source_resource_type: d.source_resource_type,
          source_resource_id: d.source_resource_id,
          source_version: d.source_version,
          source_ref_id: d.source_ref_id,
          deep_link: d.deep_link,
          action_required: d.action_required,
          action_label: d.action_label,
          deadline: d.deadline,
          work_item_id: d.work_item_id,
          read_at: null,
          snoozed_until: null,
          dismissed_at: null,
          resolved_at: null,
          expires_at: d.expires_at,
          deduplication_key: d.dedup_key,
          event_id: d.event_id,
          delivery_channels: ["in_app"],
          rule_version: d.rule_version,
          updated_at: now,
        },
        { onConflict: "org_id,recipient_twin_id,deduplication_key", ignoreDuplicates: true }
      );
      if (error) throw error;
      // With ignoreDuplicates, only NEW rows come back — accurate idempotent count.
      const inserted = (data ?? []).length;
      created += inserted;
      if (inserted > 0) {
        await supabase.from("notification_events").insert({
          org_id: orgId,
          recipient_twin_id: d.recipient_twin_id,
          event_type: "generated",
          detail: { notification_type: d.type, deduplication_key: d.dedup_key },
        }).then(() => undefined).catch(() => undefined);
      }
    }

    // ---- Resolution: actionable notifications whose source condition is gone.
    const active = notifActiveConditions(inputs, todayKey);
    const activeKeys = new Set(active.map((a) => `${a.type}|${a.source_resource_type}|${a.source_resource_id}|${a.source_version}`));
    const { data: openActionable } = await supabase
      .from("notifications")
      .select("id, recipient_twin_id, type, source_resource_type, source_resource_id, source_version, resolved_at")
      .eq("org_id", orgId)
      .eq("action_required", true)
      .is("resolved_at", null)
      .is("dismissed_at", null)
      .limit(1000);
    let resolved = 0;
    for (const n of openActionable ?? []) {
      const key = `${n.type}|${n.source_resource_type}|${n.source_resource_id}|${n.source_version}`;
      if (!activeKeys.has(key)) {
        await supabase.from("notifications").update({ resolved_at: now, updated_at: now }).eq("id", n.id);
        await supabase.from("notification_events").insert({
          org_id: orgId,
          recipient_twin_id: n.recipient_twin_id,
          notification_id: n.id,
          event_type: "resolved",
          detail: { notification_type: n.type },
        }).then(() => undefined).catch(() => undefined);
        resolved++;
      }
    }

    return json({ ok: true, generated: created, resolved, scanned_at: now, org_id: orgId });
  } catch (err) {
    console.error("notify-scan failed:", err);
    return json({ error: "INTERNAL", message: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
