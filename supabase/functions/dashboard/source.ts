import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit, type GraphSkill } from "../_shared/skill-graph-engine.ts";
import { computeReviewIndex, REVIEW_BANDS, type ReviewBand } from "../_shared/workforce-review-index.ts";

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

const REQ_STATUSES = ["open", "on_hold", "filled", "closed"] as const;

// Phase 12: explicit metric definitions travel with the payload so every number
// on the dashboard can answer "what exactly does this count, and who is in it?".
const DEFINITIONS = {
  headcount:
    "Active workers included in scope: digital twins with role employee or manager and status 'active'. Candidates, offboarding, and service owners are excluded. Candidate twins have status 'candidate', so they never count.",
  open_requisitions:
    "Job requisitions with status 'open'. Requisitions on hold, filled, or closed are counted separately and excluded.",
  active_candidates:
    "Applicants on open requisitions whose stage is still in progress (not selected or rejected).",
  journeys:
    "Workers in scope with an active adaptive onboarding plan (latest non-superseded version). A journey is blocked when any plan task is in state blocked or failed — the same rule the onboarding center uses.",
  heatmap:
    "Per open requisition and future skill, every scoped worker falls into exactly one bucket: ready (verified direct match at/above target), below_target (direct match below the target bar), adjacent_support (adjacent/transferable path, no direct match), insufficient_evidence (no verified path — only claimed/extracted assertions), or missing (no evidence of any kind).",
};

// BFS the manager tree once from the caller — one table load, no per-twin
// lookups. Returns the caller's whole reporting subtree including themselves.
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
    .select("id, role, org_id, department")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  // Scope is decided SERVER-side from the caller's role — never from the client.
  let scope: "org" | "team";
  if (["hr_executive", "hr_partner"].includes(caller.role)) scope = "org";
  else if (caller.role === "manager") scope = "team";
  else return json({ error: "FORBIDDEN", message: "Dashboard requires HR or Manager access." }, 403);

  // Optional filters from the client body, validated server-side. Filters can
  // only narrow the server-decided scope — never widen it.
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const department = typeof body.department === "string" && body.department.trim() ? body.department.trim() : null;
  const requisitionId = typeof body.requisition_id === "string" && body.requisition_id.trim() ? body.requisition_id.trim() : null;
  const period = typeof body.period === "string" && /^\d{4}-\d{2}$/.test(body.period) ? body.period : null;
  const reviewBand = typeof body.review_band === "string" && body.review_band in REVIEW_BANDS ? (body.review_band as ReviewBand) : null;
  const minCompleteness = typeof body.min_completeness === "number" && body.min_completeness >= 0 && body.min_completeness <= 1 ? body.min_completeness : null;

  // Load all org twins once, then resolve the scoped set.
  const { data: allTwins } = await supabase
    .from("digital_twins")
    .select("id, name, role, status, org_id, signals, seniority_level, verified_skills, manager_id, attendance, delivery, promotion_lag_months, department")
    .eq("org_id", caller.org_id);

  let scoped = (allTwins ?? []).filter((t) => t.status === "active" && ["employee", "manager"].includes(t.role));
  if (scope === "team") {
    const memberIds = buildTeamMemberIds(allTwins ?? [], caller.id);
    scoped = scoped.filter((t) => memberIds.has(t.id));
  }
  if (department) {
    const dept = department.toLowerCase();
    scoped = scoped.filter((t) => (t.department ?? "").toLowerCase() === dept);
  }
  const scopedIds = new Set(scoped.map((t) => t.id));

  // Longitudinal observations for the scoped set (period-scoped, explicit gaps).
  const { data: obsRows } = await supabase
    .from("workforce_observations")
    .select("twin_id, metric, period_start, value, missing")
    .eq("org_id", caller.org_id)
    .in("twin_id", [...scopedIds]);
  let obs = (obsRows ?? []).map((o) => ({
    twin_id: o.twin_id,
    metric: o.metric,
    period: String(o.period_start).slice(0, 7),
    value: typeof o.value === "number" ? o.value : null,
    missing: o.missing === true,
  }));
  const periodBounds = obs.length > 0
    ? { start: [...obs].sort((a, b) => a.period.localeCompare(b.period))[0].period, end: [...obs].sort((a, b) => b.period.localeCompare(a.period))[0].period }
    : null;
  if (period) obs = obs.filter((o) => o.period === period);
  const obsByTwin = new Map<string, { metric: string; period: string; value: number | null; missing: boolean }[]>();
  for (const o of obs) obsByTwin.set(o.twin_id, [...(obsByTwin.get(o.twin_id) ?? []), o]);

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
  let reviewCases = scopedWithIndex
    .map((x) => ({
      twin_id: x.twin.id,
      name: x.twin.name,
      index: x.index.index,
      priority: x.index.priority,
      completeness: x.index.data_completeness,
      confidence: x.index.confidence,
      history_state: x.index.history_state,
      seeking_growth: x.index.seeking_growth,
    }))
    .sort((a, b) => b.index - a.index);
  if (reviewBand) {
    const band = REVIEW_BANDS[reviewBand];
    reviewCases = reviewCases.filter((c) => c.index >= band.min && c.index <= band.max);
  }
  if (minCompleteness !== null) {
    reviewCases = reviewCases.filter((c) => c.completeness >= minCompleteness);
  }

  // Cards — every number from real records; 0 / "No data" when absent.
  const headcount = scoped.length;
  const reviewPriorityCases = reviewCases.filter((c) => c.index >= REVIEW_THRESHOLD || c.priority === "review" || c.priority === "high").length;

  const [reqsRes, recsRes, plansRes, tasksRes] = await Promise.all([
    supabase.from("job_requisitions").select("id, title, department, status, applicants, future_skills, required_skills, seniority_level").eq("org_id", caller.org_id),
    supabase.from("recommendations").select("id, twin_id, category, urgency, status, proposed_action, executive_summary").eq("org_id", caller.org_id).eq("status", "needs_review"),
    supabase.from("onboarding_plans").select("id, twin_id, version, status").eq("org_id", caller.org_id).not("status", "eq", "superseded"),
    supabase.from("onboarding_tasks").select("plan_id, state").eq("org_id", caller.org_id),
  ]);

  const reqs = (reqsRes.data ?? []) as {
    id: string;
    title: string;
    department: string;
    status: string;
    applicants: { stage: string }[];
    future_skills: { skill: string; target_proficiency: number }[];
    required_skills: { skill: string; target_proficiency: number }[];
    seniority_level: number;
  }[];
  const scopedReqs = requisitionId ? reqs.filter((r) => r.id === requisitionId) : reqs;
  const openReqs = scopedReqs.filter((r) => r.status === "open");
  const reqStatusCounts = Object.fromEntries(REQ_STATUSES.map((s) => [s, scopedReqs.filter((r) => r.status === s).length])) as Record<string, number>;
  const applicants = scopedReqs.flatMap((r) => r.applicants ?? []);
  const activeCandidates = applicants.filter((a) => !["selected", "rejected"].includes(a.stage)).length;
  const STAGE_ORDER = ["screening", "technical_interview", "final_round", "selected", "rejected"] as const;
  const activeByStage = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<string, number>;
  for (const a of applicants) {
    const st = String((a as { stage?: string }).stage ?? "");
    if (st in activeByStage) activeByStage[st] += 1;
  }

  // Onboarding journeys are derived from the CANONICAL adaptive plans: a worker
  // in scope has one active plan (latest non-superseded version). A journey is
  // blocked when any task is in state blocked or failed — the same rule as the
  // engine's readiness.blocked_count, so the dashboard agrees with the
  // onboarding center.
  const activePlansByTwin = new Map<string, { id: string; twin_id: string; version: number; status: string }>();
  for (const p of (plansRes.data ?? []) as { id: string; twin_id: string; version: number; status: string }[]) {
    if (!scopedIds.has(p.twin_id)) continue;
    const cur = activePlansByTwin.get(p.twin_id);
    if (!cur || p.version > cur.version) activePlansByTwin.set(p.twin_id, p);
  }
  const activePlans = [...activePlansByTwin.values()];
  const stateByPlan = new Map<string, string[]>();
  for (const t of (tasksRes.data ?? []) as { plan_id: string; state: string }[]) {
    stateByPlan.set(t.plan_id, [...(stateByPlan.get(t.plan_id) ?? []), t.state]);
  }
  const journeysInProgress = activePlans.length;
  const journeysBlocked = activePlans.filter((p) => (stateByPlan.get(p.id) ?? []).some((s) => s === "blocked" || s === "failed")).length;
  const journeysOnTrack = journeysInProgress - journeysBlocked;

  const pendingRecs = (recsRes.data ?? []).filter((r) => scope === "org" || (r.twin_id && scopedIds.has(r.twin_id)));

  // Heatmap: for every OPEN requisition's future skills, bucket each scoped
  // worker into exactly one of missing / below_target / adjacent_support /
  // insufficient_evidence / ready. "Insufficient evidence" means claims exist
  // (claimed or extracted assertions) but no verified skill path does.
  const { data: graphRes } = await supabase
    .from("skill_graph")
    .select("id, skill, category, outgoing_edges")
    .eq("org_id", caller.org_id);
  const graph = (graphRes ?? []) as (GraphSkill & { id: string })[];
  const skillNameById = new Map<string, string>((graph ?? []).map((g) => [g.id, g.skill]));
  const { data: assertionRows } = scopedIds.size > 0
    ? await supabase
        .from("skill_assertions")
        .select("twin_id, skill_id, review_state")
        .eq("org_id", caller.org_id)
        .in("twin_id", [...scopedIds])
        .in("review_state", ["claimed", "extracted"])
    : { data: [] };
  const claimsByTwin = new Map<string, Set<string>>();
  for (const a of assertionRows ?? []) {
    const skillName = skillNameById.get(a.skill_id);
    if (!skillName) continue;
    const set = claimsByTwin.get(a.twin_id) ?? new Set<string>();
    set.add(skillName);
    claimsByTwin.set(a.twin_id, set);
  }

  const heatmap: {
    skill: string;
    target_proficiency: number;
    req_id: string;
    req_title: string;
    buckets: { missing: number; below_target: number; adjacent_support: number; insufficient_evidence: number; ready: number };
    total: number;
  }[] = [];
  for (const req of openReqs) {
    for (const fs of req.future_skills ?? []) {
      const buckets = { missing: 0, below_target: 0, adjacent_support: 0, insufficient_evidence: 0, ready: 0 };
      for (const twin of scoped) {
        const fit = computeFit({
          candidateSkills: (twin.verified_skills ?? []) as { name: string; proficiency: number; evidence_source: string; verification_rigor: "low" | "medium" | "high" }[],
          candidateLevel: twin.seniority_level ?? 3,
          requiredSkills: [{ skill: fs.skill, target_proficiency: fs.target_proficiency }],
          roleLevel: req.seniority_level,
          skillGraph: graph,
          target: { type: "requisition", id: req.id, title: req.title },
          scenario: "future",
        });
        const item = fit.scoring.requirements.find((i) => i.skill.toLowerCase() === fs.skill.toLowerCase());
        if (item && item.relationship === "direct") {
          const p = item.candidate_proficiency ?? 0;
          if (p >= fs.target_proficiency) buckets.ready += 1;
          else buckets.below_target += 1;
        } else if (item && (item.relationship === "adjacent" || item.relationship === "transferable")) {
          buckets.adjacent_support += 1;
        } else if (claimsByTwin.get(twin.id)?.has(fs.skill.toLowerCase()) || claimsByTwin.get(twin.id)?.has(fs.skill)) {
          buckets.insufficient_evidence += 1;
        } else {
          buckets.missing += 1;
        }
      }
      heatmap.push({
        skill: fs.skill,
        target_proficiency: fs.target_proficiency,
        req_id: req.id,
        req_title: req.title,
        buckets,
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

  const availableDepartments = [...new Set((allTwins ?? [])
    .filter((t) => t.status === "active" && ["employee", "manager"].includes(t.role))
    .map((t) => t.department)
    .filter(Boolean))].sort() as string[];
  const availableRequisitions = reqs.map((r) => ({ id: r.id, title: r.title, status: r.status }));

  return json({
    ok: true,
    scope,
    threshold: REVIEW_THRESHOLD,
    computed_at: new Date().toISOString(),
    period: {
      label: period ?? (periodBounds ? `all observations (${periodBounds.start} – ${periodBounds.end})` : "no observations in scope"),
      start: period ?? periodBounds?.start ?? null,
      end: period ?? periodBounds?.end ?? null,
      filtered: !!period,
    },
    // Full observation range regardless of the applied period filter, so the
    // client can keep offering every selectable month.
    observation_range: periodBounds,
    definitions: DEFINITIONS,
    filters: {
      applied: { department, requisition_id: requisitionId, period, review_band: reviewBand, min_completeness: minCompleteness },
      available: { departments: availableDepartments, requisitions: availableRequisitions },
    },
    review_cases: reviewCases,
    // Phase 14: decision-oriented distributions — hiring funnel by stage and
    // review-band counts, each with denominators (sample sizes) so no number
    // floats without context.
    hiring_funnel: STAGE_ORDER.map((stage) => ({
      stage,
      count: activeByStage[stage] ?? 0,
    })),
    review_band_counts: {
      low: reviewCases.filter((c) => c.priority === "low").length,
      medium: reviewCases.filter((c) => c.priority === "medium").length,
      high: reviewCases.filter((c) => c.priority === "high").length,
      review: reviewCases.filter((c) => c.priority === "review").length,
      total: reviewCases.length,
    },
    cards: {
      headcount,
      open_requisitions: openReqs.length,
      requisition_statuses: reqStatusCounts,
      active_candidates: activeCandidates,
      journeys_in_progress: journeysInProgress,
      journeys_on_track: journeysOnTrack,
      journeys_blocked: journeysBlocked,
      review_priority_cases: reviewPriorityCases,
      pending_recommendations: pendingRecs.length,
    },
    heatmap,
    recommendations,
  });
});
