import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeReviewIndex, reviewSourceHash } from "../_shared/workforce-review-index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function isTeamMember(supabase, rootTwinId: string, checkTwinId: string): Promise<boolean> {
  const { data } = await supabase.from("digital_twins").select("id, manager_id");
  const children = new Map<string, string[]>();
  for (const t of data ?? []) {
    if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
  }
  const seen = new Set<string>();
  const stack = [rootTwinId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of children.get(cur) ?? []) stack.push(c);
  }
  return seen.has(checkTwinId);
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

  let body: { twin_id?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const twinId = (body.twin_id ?? "").trim();
  if (!twinId) return json({ error: "VALIDATION_ERROR", message: "twin_id is required." }, 400);

  const { data: twin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, org_id, role, tenure_months, promotion_lag_months, attendance, delivery, signals, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !twin) return json({ error: "NOT_FOUND" }, 404);

  let allowed = false;
  if (["hr_executive", "hr_partner"].includes(caller.role)) allowed = twin.org_id === caller.org_id;
  else if (caller.role === "manager" || caller.role === "employee") {
    allowed = twin.id === caller.id || (caller.role === "manager" && (await isTeamMember(supabase, caller.id, twin.id)));
  }
  if (!allowed) return json({ error: "FORBIDDEN" }, 403);

  // Longitudinal observations for this twin (period-scoped, explicit missing).
  const { data: obsRows } = await supabase
    .from("workforce_observations")
    .select("metric, period_start, value, missing")
    .eq("org_id", caller.org_id)
    .eq("twin_id", twinId)
    .order("period_start", { ascending: true });
  const observations = (obsRows ?? []).map((o) => ({
    metric: o.metric,
    period: String(o.period_start).slice(0, 7),
    value: typeof o.value === "number" ? o.value : null,
    missing: o.missing === true,
  }));

  const signals = (twin.signals ?? []) as { type?: string; value?: unknown }[];
  const seeksGrowth = signals.some((s) => s.type === "seeks_growth" && s.value === true);
  const now = new Date().toISOString();

  const input = {
    twin_id: twinId,
    promotion_lag_months: twin.promotion_lag_months ?? 0,
    attendance: twin.attendance ?? {},
    delivery: twin.delivery ?? {},
    observations,
    seeks_growth: seeksGrowth,
    computed_at: now,
  };
  const result = computeReviewIndex(input);
  const hash = reviewSourceHash(input);

  const periodStart = observations.length > 0 ? `${observations[0].period}-01` : `${now.slice(0, 7)}-01`;
  const periodEnd = observations.length > 0 ? `${observations[observations.length - 1].period}-28` : now.slice(0, 10);

  // Authorized reviewer actions for this case (dismiss/defer/acknowledge).
  const { data: actionRows } = await supabase
    .from("review_case_actions")
    .select("id, action, reason, follow_up_at, acted_by, acted_at")
    .eq("org_id", caller.org_id)
    .eq("twin_id", twinId)
    .order("acted_at", { ascending: true });
  const actions = (actionRows ?? []).map((a) => ({
    id: a.id,
    action: a.action,
    reason: a.reason,
    follow_up_at: a.follow_up_at ?? null,
    acted_by: a.acted_by,
    acted_at: a.acted_at,
  }));

  // Intervention outcomes (item 8): post-action observation deltas, explicitly
  // labeled as observed-after — correlation, never causation.
  const metricByWeight = Object.entries(result.factors).sort((a, b) => b[1].score - a[1].score);
  const primaryMetric = metricByWeight[0] && metricByWeight[0][1].score > 0 ? (metricByWeight[0][0] === "career" ? "engagement" : metricByWeight[0][0]) : "engagement";
  const metricValues = observations
    .filter((o) => o.metric === primaryMetric && !o.missing && typeof o.value === "number")
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((o) => ({ period: o.period, value: o.value as number }));
  const outcomes = actions
    .map((a) => {
      const at = String(a.acted_at).slice(0, 7);
      const before = metricValues.filter((v) => v.period < at).slice(-3);
      const after = metricValues.filter((v) => v.period >= at).slice(0, 3);
      if (before.length === 0 || after.length === 0) return null;
      const bm = before.reduce((s, v) => s + v.value, 0) / before.length;
      const am = after.reduce((s, v) => s + v.value, 0) / after.length;
      return {
        action_id: a.id,
        action: a.action,
        metric: primaryMetric,
        before_mean: +bm.toFixed(2),
        after_mean: +am.toFixed(2),
        delta: +(am - bm).toFixed(2),
        observed_after: `${before[before.length - 1].period} → ${after[after.length - 1].period}`,
        note: `Observed after the ${a.action} action — correlation, not causation; confirm with the employee before drawing conclusions.`,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  // Upsert the stored case (longitudinal review record).
  const caseRow = {
    org_id: caller.org_id,
    twin_id: twinId,
    period_start: periodStart,
    period_end: periodEnd,
    index: result.index,
    priority: result.priority,
    factors: result.factors,
    trend: result.trend,
    data_completeness: result.data_completeness,
    missing_data: result.missing_data,
    fact_finding: result.recommended_fact_finding,
    seeking_growth: result.seeking_growth,
    sensitivity: result.sensitivity,
    limitations: result.limitations,
    priority_gate: result.priority_gate,
    confidence: result.confidence,
    confidence_reason: result.confidence_reason,
    history_state: result.history_state,
    data_quality: result.data_quality,
    freshness: result.freshness,
    case_rationale: result.case_rationale,
    source_version_hash: hash,
    computed_at: now,
  };
  const { data: existing } = await supabase
    .from("workforce_review_cases")
    .select("id, source_version_hash")
    .eq("org_id", caller.org_id)
    .eq("twin_id", twinId)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing && existing.source_version_hash === hash && !body.force) {
    // Data unchanged since the last computation — return the stored result.
    return json({ ok: true, cached: true, ...result, case: caseRow, actions, outcomes, label: "Workforce Review Index — decision support, not a probability." });
  }
  if (existing) {
    const { error: upErr } = await supabase
      .from("workforce_review_cases")
      .update({ ...caseRow, updated_at: now })
      .eq("id", existing.id);
    if (upErr) return json({ error: "INTERNAL", message: upErr.message }, 500);
  } else {
    const { error: insErr } = await supabase.from("workforce_review_cases").insert(caseRow);
    if (insErr) return json({ error: "INTERNAL", message: insErr.message }, 500);
  }

  // Reflect the index on the twin's signals (replaces the legacy risk label).
  const nextSignals = [
    ...signals.filter((s) => s.type !== "workforce_review_signal" && s.type !== "workforce_review_index"),
    {
      type: "workforce_review_index",
      value: result.index,
      priority: result.priority,
      data_completeness: result.data_completeness,
      computed_at: now,
      factors: result.factors,
      label: "Workforce Review Index — interpretable decision support, NOT a probability of leaving.",
    },
  ];

  await supabase
    .from("digital_twins")
    .update({
      signals: nextSignals,
      audit_events: [
        ...(twin.audit_events ?? []),
        { actor: caller.id, action: "workforce_review_index_computed", note: `Workforce Review Index computed: ${result.index}/100 (${result.priority}).`, timestamp: now },
      ],
    })
    .eq("id", twinId);

  return json({
    ok: true,
    cached: false,
    ...result,
    case: caseRow,
    actions,
    outcomes,
    label: "Workforce Review Index — decision support, not a probability.",
  });
});
