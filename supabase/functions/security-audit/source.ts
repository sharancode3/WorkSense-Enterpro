// Batch H (H1): honest security audit feed for administrators.
// Merges canonical sources ONLY — admin_actions (access governance), canonical
// workflow_events (recommendation + action-task lifecycle), application stage
// events (candidate decisions), and onboarding waivers. Legacy audit_events
// jsonb arrays are never read, so the same logical fact cannot be surfaced
// twice; each emitted event carries a stable source-prefixed key and the feed
// dedupes on it. Pagination is honest: exact per-source counts sum to `total`,
// and the requested page is fetched with bounded per-source limits. Actor and
// target names are resolved server-side. Every event can carry an authorized
// deep link into the module that owns it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const KINDS = ["access", "recruitment", "recommendations", "onboarding"] as const;
const ACTION_LABEL: Record<string, string> = {
  invite: "MEMBER_INVITED",
  update_role: "ROLE_CHANGED",
  suspend: "ACCOUNT_SUSPENDED",
  reactivate: "ACCOUNT_REACTIVATED",
};
const SOURCE_CAP = 1000;

interface AuditItem {
  key: string;
  kind: (typeof KINDS)[number];
  label: string;
  detail: string;
  actor: string | null;
  reason: string | null;
  at: string;
  href: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, org_id, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);
  if (caller.role !== "hr_executive") {
    return json({ error: "FORBIDDEN", message: "Security audit requires administrator access." }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const rawKind = String(body.kind ?? "");
  const kind: (typeof KINDS)[number] | null = (KINDS as readonly string[]).includes(rawKind) ? (rawKind as typeof KINDS[number]) : null;
  const page = Math.max(1, Number(body.page) || 1);
  const pageSize = Math.max(1, Math.min(50, Number(body.page_size) || 25));
  const offset = (page - 1) * pageSize;
  const limit = offset + pageSize;

  // Name resolution map.
  const { data: allTwins } = await supabase.from("digital_twins").select("id, name, role").eq("org_id", caller.org_id);
  const nameById = new Map<string, string>((allTwins ?? []).map((t) => [t.id, t.name]));

  // Candidate/application joins for recruitment events.
  const { data: appRows } = await supabase
    .from("applications")
    .select("id, candidate_twin_id, requisition_id")
    .eq("org_id", caller.org_id);
  const candidateByApp = new Map<string, { id: string; candidate_twin_id: string; requisition_id: string | null }>(
    ((appRows ?? []) as { id: string; candidate_twin_id: string; requisition_id: string | null }[]).map((a) => [a.id, a])
  );

  const want = (k: (typeof KINDS)[number]) => (kind === null || kind === k);

  const items: AuditItem[] = [];
  let total = 0;
  const truncatedSources: string[] = [];

  // 1) Access governance.
  if (want("access")) {
    const { count } = await supabase
      .from("admin_actions")
      .select("*", { count: "exact", head: true })
      .eq("org_id", caller.org_id);
    total += count ?? 0;
    const { data, error } = await supabase
      .from("admin_actions")
      .select("id, action, actor_twin_id, target_twin_id, target_email, before_data, after_data, reason, created_at")
      .eq("org_id", caller.org_id)
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, SOURCE_CAP));
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    if ((count ?? 0) > SOURCE_CAP) truncatedSources.push("access");
    for (const a of data ?? []) {
      const before = (a.before_data ?? {}) as Record<string, unknown>;
      const after = (a.after_data ?? {}) as Record<string, unknown>;
      const targetName = a.target_twin_id ? (nameById.get(a.target_twin_id) ?? null) : null;
      items.push({
        key: `adm:${a.id}`,
        kind: "access",
        label: ACTION_LABEL[a.action] ?? a.action.toUpperCase(),
        detail: `${targetName ?? a.target_email ?? "member"}${a.action === "update_role" ? ` · ${String(before.role ?? "—")} → ${String(after.role ?? "—")}` : a.action === "suspend" || a.action === "reactivate" ? ` · ${String(before.status ?? "—")} → ${String(after.status ?? "—")}` : ""}`,
        actor: a.actor_twin_id ? (nameById.get(a.actor_twin_id) ?? null) : null,
        reason: a.reason,
        at: a.created_at,
        href: "/admin/access",
      });
    }
  }

  // 2) Recommendation + action-task lifecycle (canonical workflow_events).
  if (want("recommendations")) {
    const { count } = await supabase
      .from("workflow_events")
      .select("*", { count: "exact", head: true })
      .eq("org_id", caller.org_id);
    total += count ?? 0;
    const { data, error } = await supabase
      .from("workflow_events")
      .select("id, resource_type, resource_id, actor_twin_id, actor_role, resource, prior_status, new_status, reason, created_at")
      .eq("org_id", caller.org_id)
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, SOURCE_CAP));
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    if ((count ?? 0) > SOURCE_CAP) truncatedSources.push("recommendations");
    for (const e of data ?? []) {
      const resourceName = e.resource || e.resource_id;
      const actor = e.actor_twin_id ? (nameById.get(e.actor_twin_id) ?? null) : e.actor_role ? e.actor_role.replace(/_/g, " ") : null;
      items.push({
        key: `wfe:${e.id}`,
        kind: "recommendations",
        label: `${e.resource_type === "action_task" ? "ACTION_TASK" : "RECOMMENDATION"}_${String(e.new_status ?? "").toUpperCase()}`,
        detail: `${String(resourceName).slice(0, 60)} · ${e.prior_status ?? "—"} → ${e.new_status ?? "—"}`,
        actor,
        reason: e.reason,
        at: e.created_at,
        href: e.resource_type === "recommendation" ? `/hub?rec=${e.resource_id}` : null,
      });
    }
  }

  // 3) Candidate decisions (canonical application stage events).
  if (want("recruitment")) {
    const q = supabase
      .from("application_stage_events")
      .select("*", { count: "exact", head: true })
      .eq("org_id", caller.org_id)
      .in("new_stage", ["selected", "rejected"]);
    const { count } = await q;
    total += count ?? 0;
    const { data, error } = await supabase
      .from("application_stage_events")
      .select("id, application_id, actor_twin_id, prior_stage, new_stage, reason, at")
      .eq("org_id", caller.org_id)
      .in("new_stage", ["selected", "rejected"])
      .order("at", { ascending: false })
      .limit(Math.min(limit, SOURCE_CAP));
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    if ((count ?? 0) > SOURCE_CAP) truncatedSources.push("recruitment");
    for (const e of data ?? []) {
      const cand = candidateByApp.get(e.application_id);
      const candName = cand ? (nameById.get(cand.candidate_twin_id) ?? null) : null;
      items.push({
        key: `appev:${e.id}`,
        kind: "recruitment",
        label: e.new_stage === "selected" ? "CANDIDATE_SELECTED" : "CANDIDATE_REJECTED",
        detail: `${candName ?? "candidate"} · ${e.prior_stage} → ${e.new_stage}`,
        actor: e.actor_twin_id ? (nameById.get(e.actor_twin_id) ?? null) : null,
        reason: e.reason,
        at: e.at,
        href: cand ? `/recruitment?cand=${cand.candidate_twin_id}` : null,
      });
    }
  }

  // 4) Onboarding policy waivers.
  if (want("onboarding")) {
    const { count } = await supabase
      .from("onboarding_tasks")
      .select("*", { count: "exact", head: true })
      .eq("org_id", caller.org_id)
      .not("waiver", "is", null);
    total += count ?? 0;
    const { data, error } = await supabase
      .from("onboarding_tasks")
      .select("id, task_code, title, waiver, updated_at")
      .eq("org_id", caller.org_id)
      .not("waiver", "is", null)
      .order("updated_at", { ascending: false })
      .limit(Math.min(limit, SOURCE_CAP));
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    if ((count ?? 0) > SOURCE_CAP) truncatedSources.push("onboarding");
    for (const w of data ?? []) {
      const waiver = (w.waiver ?? {}) as { by_name?: string; reason?: string; policy_basis?: { doc_code?: string } };
      items.push({
        key: `wv:${w.id}`,
        kind: "onboarding",
        label: "POLICY_WAIVED",
        detail: `${w.task_code}${w.title ? ` · ${w.title}` : ""}${waiver.policy_basis?.doc_code ? ` · ${waiver.policy_basis.doc_code}` : ""}`,
        actor: waiver.by_name ?? null,
        reason: waiver.reason ?? null,
        at: w.updated_at,
        href: "/onboarding",
      });
    }
  }

  // Dedup by stable key, sort newest first, slice the requested page.
  const seen = new Set<string>();
  const deduped = items.filter((it) => {
    if (seen.has(it.key)) return false;
    seen.add(it.key);
    return true;
  });
  deduped.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const pageItems = deduped.slice(offset, offset + pageSize);

  return json({ ok: true, total: deduped.length, page, page_size: pageSize, items: pageItems, truncated_sources: truncatedSources });
});
