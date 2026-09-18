import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { scanForRecommendations, type RecCandidate } from "../_shared/recommendation-engine.ts";
import { computeReviewIndex } from "../_shared/workforce-review-index.ts";
import { candidateSourceHash } from "../_shared/workflow-engine.ts";
import { callQwen, QwenError } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUMMARY_SYSTEM = `You are the WorkSense Decision Support Synthesizer. You are given an already-computed evidence_ledger and urgency — do not change or second-guess the numbers. Write a short executive_summary connecting the evidence into a clear rationale for the proposed action, for a human to approve or reject. You are not making the decision.
Respond with JSON only:
{"title":"string","executive_summary":"string","proposed_action":{"action_type":"string","target_entity_id":"string"},"required_human_signoff_role":"HR_EXECUTIVE|MANAGER|RECRUITER"}`;

// Non-terminal states a candidate may already occupy.
const OPEN_STATUSES = ["suggested", "needs_review", "approved", "execution_pending", "in_progress", "failed"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {

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
    .select("id, role, org_id, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !["hr_executive", "hr_partner"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "HR access required to run the intelligence scan." }, 403);
  }

  // Load the org's data sources.
  const [twinsRes, reqsRes, graphRes, plansRes, tasksRes, openRecsRes, obsRes, appsRes, assertionsRes] = await Promise.all([
    supabase.from("digital_twins").select("id, name, role, status, signals, performance_history, verified_skills, seniority_level, job_title, attendance, delivery, promotion_lag_months, manager_id").eq("org_id", caller.org_id),
    supabase.from("job_requisitions").select("id, title, required_skills, future_skills, seniority_level").eq("org_id", caller.org_id),
    supabase.from("skill_graph").select("skill, category, outgoing_edges").eq("org_id", caller.org_id),
    supabase.from("onboarding_plans").select("id, twin_id, version, status").eq("org_id", caller.org_id).not("status", "eq", "superseded"),
    supabase.from("onboarding_tasks").select("plan_id, task_code, title, state, blockers").eq("org_id", caller.org_id),
    supabase.from("recommendations").select("id, twin_id, category, status, source_hash").eq("org_id", caller.org_id).in("status", OPEN_STATUSES),
    supabase.from("workforce_observations").select("twin_id, metric, period_start, value, missing").eq("org_id", caller.org_id),
    supabase.from("applications").select("candidate_twin_id, requisition_id, stage, application_code").eq("org_id", caller.org_id).in("stage", ["screening", "technical_interview", "final_round"]),
    supabase.from("skill_assertions").select("twin_id, review_state").eq("org_id", caller.org_id).eq("review_state", "claimed"),
  ]);

  // Onboarding replan triggers come from the CANONICAL adaptive plans: map the
  // latest non-superseded plan per twin into the engine's journey shape. A
  // task in state blocked carries its first open blocker's note as evidence.
  const activePlanByTwin = new Map<string, { id: string; twin_id: string; version: number; status: string }>();
  for (const p of (plansRes.data ?? []) as { id: string; twin_id: string; version: number; status: string }[]) {
    const cur = activePlanByTwin.get(p.twin_id);
    if (!cur || p.version > cur.version) activePlanByTwin.set(p.twin_id, p);
  }
  const tasksByPlan = new Map<string, { task_code: string; title: string; state: string; blockers?: { status?: string; note?: string }[] }[]>();
  for (const t of (tasksRes.data ?? []) as { plan_id: string; task_code: string; title: string; state: string; blockers?: { status?: string; note?: string }[] }[]) {
    tasksByPlan.set(t.plan_id, [...(tasksByPlan.get(t.plan_id) ?? []), t]);
  }
  const journeys = [...activePlanByTwin.values()].map((p) => {
    const tasks = (tasksByPlan.get(p.id) ?? []).map((t) => ({
      id: t.task_code,
      title: t.title,
      status: t.state,
      blocked: (t.blockers ?? []).find((b) => b.status === "open")
        ? { note: (t.blockers ?? []).find((b) => b.status === "open")?.note ?? "blocker reported" }
        : null,
    }));
    return { twin_id: p.twin_id, status: p.status, tasks };
  });

  // Unverified claim counts per candidate — recruitment recommendations
  // require actual application evidence AND visible assessment gaps.
  const unverifiedByTwin = new Map<string, number>();
  for (const a of assertionsRes.data ?? []) {
    unverifiedByTwin.set(a.twin_id, (unverifiedByTwin.get(a.twin_id) ?? 0) + 1);
  }
  const applications = (appsRes.data ?? []).map((a) => ({
    twin_id: a.candidate_twin_id,
    requisition_id: a.requisition_id,
    stage: a.stage,
    application_code: a.application_code,
    unverified_claims: unverifiedByTwin.get(a.candidate_twin_id) ?? 0,
  }));

  // Phase 9: compute the deterministic Workforce Review Index per twin and feed
  // it (with completeness/growth meta) into the trigger engine. Missing data is
  // visible and never escalates a case; seeking growth never adds risk.
  const obsByTwin = new Map<string, { metric: string; period: string; value: number | null; missing: boolean }[]>();
  for (const o of obsRes.data ?? []) {
    const row = { metric: o.metric, period: String(o.period_start).slice(0, 7), value: typeof o.value === "number" ? o.value : null, missing: o.missing === true };
    obsByTwin.set(o.twin_id, [...(obsByTwin.get(o.twin_id) ?? []), row]);
  }
  const twinsWithIndex = (twinsRes.data ?? []).map((t) => {
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
    return {
      id: t.id,
      name: t.name,
      role: t.role,
      status: t.status,
      signals: [...signals, { type: "workforce_review_index", value: r.index, priority: r.priority, computed_at: new Date().toISOString(), factors: r.factors }],
      performance_history: (t.performance_history ?? []) as { cycle: string; rating: string; goals_met?: number }[],
      verified_skills: (t.verified_skills ?? []) as { name: string; proficiency: number; evidence_source?: string; verification_rigor?: string }[],
      seniority_level: t.seniority_level,
      job_title: t.job_title,
      review_meta: { data_completeness: r.data_completeness, priority: r.priority, seeking_growth: seeks },
    };
  });

  const candidates = scanForRecommendations({
    twins: twinsWithIndex,
    requisitions: reqsRes.data ?? [],
    graph: graphRes.data ?? [],
    journeys,
    applications,
  });

  // Canonical stored category names (stable across seed + scan).
  const CATEGORY_DB: Record<string, string> = {
    RETENTION_INTERVENTION: "workforce_review",
    INTERNAL_MOBILITY: "mobility",
    ONBOARDING_REPLAN: "onboarding_replan",
    DEVELOPMENT_SUPPORT: "development_support",
    RECRUITMENT_ASSESSMENT_REVIEW: "recruitment_review",
  };

  // Phase 11: recurring scans deduplicate by source hash and EXPLAIN updates.
  // Same (twin, category, hash) -> no-op. Same (twin, category) but a changed
  // hash -> the old open recommendation is marked stale (re-review required)
  // and a fresh one is created. Identical recommendations are never re-created.
  const existingByKey = new Map<string, { id: string; status: string; source_hash: string | null }[]>();
  for (const r of openRecsRes.data ?? []) {
    const key = `${r.twin_id ?? "none"}|${String(r.category).toLowerCase()}`;
    existingByKey.set(key, [...(existingByKey.get(key) ?? []), r]);
  }

  const now = new Date().toISOString();
  const created: RecCandidate[] = [];
  let unchanged = 0;
  let madeStale = 0;

  for (const c of candidates) {
    const dbCat = CATEGORY_DB[c.category] ?? c.category.toLowerCase();
    const key = `${c.twin_id ?? "none"}|${dbCat}`;
    const hash = candidateSourceHash({ category: dbCat, twin_id: c.twin_id, evidence: c.evidence_ledger });
    const existing = existingByKey.get(key) ?? [];

    const sameHash = existing.filter((r) => r.source_hash === hash);
    if (sameHash.length > 0) {
      unchanged++; // already tracked with the same evidence — no duplicate
      continue;
    }

    // ONE Qwen call per NEW recommendation — language only, never facts/urgency.
    const parsed = (await callQwen({
      json: true,
      temperature: 0.2,
      maxTokens: 300,
      system: SUMMARY_SYSTEM,
      user: `Category: ${c.category}\nUrgency: ${c.urgency}\nEvidence ledger:\n${JSON.stringify(c.evidence_ledger, null, 2)}\nWrite the synthesis JSON.`,
    })) as {
      title?: string;
      executive_summary?: string;
      proposed_action?: { action_type?: string; target_entity_id?: string };
      required_human_signoff_role?: string;
    };

    const { data: inserted, error } = await supabase
      .from("recommendations")
      .insert({
        org_id: caller.org_id,
        twin_id: c.twin_id,
        category: dbCat,
        urgency: c.urgency,
        evidence_ledger: c.evidence_ledger,
        proposed_action: {
          ...c.proposed_action,
          title: parsed.title ?? c.proposed_action.title,
          executive_summary: parsed.executive_summary ?? "",
          action_type: c.category,
          target_entity_id: c.twin_id,
        },
        executive_summary: parsed.executive_summary ?? "",
        resource_ref: c.resource_ref ?? null,
        alternatives: c.alternatives ?? [],
        intended_outcome: { review_kind: c.category, outcome: "Resolve the review through the approved action tasks; record the outcome without claiming causality for workforce interventions." },
        source_hash: hash,
        // The scan is the deterministic suggester: a fresh candidate enters the
        // lifecycle at "suggested" and moves to "needs_review" via submit.
        status: "suggested",
        required_signoff_role: c.required_signoff_role,
        reviewer_rationale: {},
        audit_events: [{ actor: caller.email ?? uid, action: "suggested", note: `Suggested by intelligence scan (${c.category}); source hash ${hash}.`, timestamp: now }],
      })
      .select("id")
      .single();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);

    // Material source change: mark the older open recommendation stale and
    // point it at the fresh one — re-review required.
    const changed = existing.filter((r) => r.source_hash !== hash && r.status !== "stale");
    for (const old of changed) {
      const { data: staleRes, error: staleErr } = await supabase.rpc("workflow_recommendation_transition", {
        p_org_id: caller.org_id,
        p_rec_id: old.id,
        p_action: "mark_stale",
        p_actor_twin_id: caller.id,
        p_actor_role: caller.role,
        p_reason: `Source changed: a newer scan produced updated evidence for this case (${c.category}). Re-review required.`,
        p_request_id: crypto.randomUUID(),
        p_source_version: old.source_hash ?? null,
        p_payload: { superseded_by: inserted.id },
      });
      if (!staleErr && staleRes?.ok) madeStale++;
    }

    created.push(c);
  }

  return json({
    ok: true,
    scanned_candidates: candidates.length,
    created: created.length,
    unchanged,
    made_stale: madeStale,
    created_ids: created.map((c) => c.category),
  });
  } catch (err) {
    return json({ error: err instanceof QwenError ? err.code : "INTERNAL", message: err instanceof Error ? err.message : "unknown" });
  }
});
