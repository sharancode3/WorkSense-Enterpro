import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit, type GraphSkill } from "../_shared/skill-graph-engine.ts";
import { computeReviewIndex } from "../_shared/workforce-review-index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
// Review-priority threshold: index >= 60 is a high-priority review case.
// The index is decision support, never a probability of leaving.
export const REVIEW_THRESHOLD = 60;

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

  // Scope is decided SERVER-side from the caller's role — never from the client.
  let scope: "org" | "team";
  if (["hr_executive", "hr_partner"].includes(caller.role)) scope = "org";
  else if (caller.role === "manager") scope = "team";
  else return json({ error: "FORBIDDEN", message: "Dashboard requires HR or Manager access." }, 403);

  // Load all org twins, then resolve the scoped set.
  const { data: allTwins } = await supabase
    .from("digital_twins")
    .select("id, name, role, status, org_id, signals, seniority_level, verified_skills, manager_id, attendance, delivery, promotion_lag_months")
    .eq("org_id", caller.org_id);

  let scoped = (allTwins ?? []).filter((t) => t.status === "active" && ["employee", "manager"].includes(t.role));
  if (scope === "team") {
    const memberIds = new Set<string>();
    for (const t of scoped) {
      if (await isTeamMember(supabase, caller.id, t.id)) memberIds.add(t.id);
    }
    scoped = scoped.filter((t) => memberIds.has(t.id));
  }
  const scopedIds = new Set(scoped.map((t) => t.id));

  // Longitudinal observations for the scoped set (period-scoped, explicit gaps).
  const { data: obsRows } = await supabase
    .from("workforce_observations")
    .select("twin_id, metric, period_start, value, missing")
    .eq("org_id", caller.org_id)
    .in("twin_id", [...scopedIds]);
  const obsByTwin = new Map<string, { metric: string; period: string; value: number | null; missing: boolean }[]>();
  for (const o of obsRows ?? []) {
    const period = String(o.period_start).slice(0, 7);
    const row = { metric: o.metric, period, value: typeof o.value === "number" ? o.value : null, missing: o.missing === true };
    obsByTwin.set(o.twin_id, [...(obsByTwin.get(o.twin_id) ?? []), row]);
  }

  const reviewIndex = (t: { signals?: { type?: string }[]; attendance?: unknown; delivery?: unknown; promotion_lag_months?: number; id: string }) => {
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
    return r;
  };
  const scopedWithIndex = scoped.map((t) => ({ twin: t, index: reviewIndex(t) }));
  const reviewCases = scopedWithIndex
    .map((x) => ({
      twin_id: x.twin.id,
      name: x.twin.name,
      index: x.index.index,
      priority: x.index.priority,
      completeness: x.index.data_completeness,
      seeking_growth: x.index.seeking_growth,
    }))
    .sort((a, b) => b.index - a.index);

  // Cards — every number from real records; 0 / "No data" when absent.
  const headcount = scoped.length;
  const reviewPriorityCases = reviewCases.filter((c) => c.index >= REVIEW_THRESHOLD || c.priority === "review" || c.priority === "high").length;

  const [reqsRes, recsRes, journeysRes] = await Promise.all([
    supabase.from("job_requisitions").select("id, title, applicants, future_skills, required_skills, seniority_level").eq("org_id", caller.org_id),
    supabase.from("recommendations").select("id, twin_id, category, urgency, status, proposed_action, executive_summary").eq("org_id", caller.org_id).eq("status", "needs_review"),
    supabase.from("onboarding_journeys").select("twin_id, status, tasks").eq("org_id", caller.org_id),
  ]);

  const reqs = (reqsRes.data ?? []) as {
    id: string; title: string;
    applicants: { stage: string }[];
    future_skills: { skill: string; target_proficiency: number }[];
    required_skills: { skill: string; target_proficiency: number }[];
    seniority_level: number;
  }[];
  const openRequisitions = reqs.length;
  const applicants = reqs.flatMap((r) => r.applicants ?? []);
  const activeCandidates = applicants.filter((a) => !["selected", "rejected"].includes(a.stage)).length;

  const journeys = (journeysRes.data ?? []).filter((j) => scopedIds.has(j.twin_id) && ["active", "pending"].includes(j.status));
  const journeysBlocked = journeys.filter((j) => (j.tasks ?? []).some((t: { status?: string }) => t.status === "blocked")).length;

  const pendingRecs = (recsRes.data ?? []).filter((r) => scope === "org" || (r.twin_id && scopedIds.has(r.twin_id)));

  // Org-wide Skill Gap Heatmap: aggregate Phase-1 Gap classifications against
  // every requisition's future_skills across all scoped DigitalTwins.
  const { data: graphRes } = await supabase
    .from("skill_graph")
    .select("skill, category, outgoing_edges")
    .eq("org_id", caller.org_id);
  const graph = (graphRes ?? []) as GraphSkill[];

  const heatmap: { skill: string; target_proficiency: number; req_id: string; req_title: string; gap_count: number; total: number }[] = [];
  for (const req of reqs) {
    for (const fs of req.future_skills ?? []) {
      let gapCount = 0;
      for (const twin of scoped) {
        const fit = computeFit({
          candidateSkills: (twin.verified_skills ?? []) as { name: string; proficiency: number }[],
          candidateLevel: twin.seniority_level ?? 3,
          requiredSkills: [{ skill: fs.skill, target_proficiency: fs.target_proficiency }],
          roleLevel: req.seniority_level,
          skillGraph: graph,
          target: { type: "requisition", id: req.id, title: req.title },
          scenario: "future",
        });
        if (fit.classification.gaps.some((g) => g.skill.toLowerCase() === fs.skill.toLowerCase())) gapCount++;
      }
      heatmap.push({
        skill: fs.skill,
        target_proficiency: fs.target_proficiency,
        req_id: req.id,
        req_title: req.title,
        gap_count: gapCount,
        total: scoped.length,
      });
    }
  }

  const recommendations = pendingRecs
    .map((r) => ({
      id: r.id,
      category: r.category,
      urgency: r.urgency,
      title: (r.proposed_action as { title?: string })?.title ?? r.category,
      executive_summary: r.executive_summary ?? "",
    }))
    .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9));

  return json({
    ok: true,
    scope,
    threshold: REVIEW_THRESHOLD,
    review_cases: reviewCases,
    cards: {
      headcount,
      open_requisitions: openRequisitions,
      active_candidates: activeCandidates,
      journeys_in_progress: journeys.length,
      journeys_on_track: journeys.length - journeysBlocked,
      journeys_blocked: journeysBlocked,
      review_priority_cases: reviewPriorityCases,
      pending_recommendations: pendingRecs.length,
    },
    heatmap,
    recommendations,
  });
});
