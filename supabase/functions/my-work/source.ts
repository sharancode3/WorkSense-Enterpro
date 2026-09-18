import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeReviewIndex } from "../_shared/workforce-review-index.ts";
import { buildMyWork, type MyWorkResult, type TaskRow, type TwinRow } from "../_shared/my-work-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    .select("id, role, org_id, manager_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  const orgId = caller.org_id;

  // Load the org's workflow records ONCE. Scoping is applied in the engine.
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

  // Review cases: compute the index fresh for scoped twins (HR org / manager team),
  // the same way the org dashboard does — never from stored snapshots.
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
  // Attach twin_id to tasks for plan-lookup independence (tasks carry plan_id).
  const planIdToTwin = new Map<string, string>();
  for (const p of plansRes.data ?? []) planIdToTwin.set((p as { id: string }).id, (p as { twin_id: string }).twin_id);
  const tasksWithTwin = tasks.map((t) => ({ ...t, twin_id: t.twin_id ?? planIdToTwin.get(t.plan_id) ?? "" }));

  const result = buildMyWork(
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

  return json(result satisfies MyWorkResult);
});
