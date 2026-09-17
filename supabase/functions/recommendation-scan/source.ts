import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { scanForRecommendations, type RecCandidate } from "../_shared/recommendation-engine.ts";
import { computeReviewIndex } from "../_shared/workforce-review-index.ts";
import { callQwen, QwenError } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUMMARY_SYSTEM = `You are the WorkSense Decision Support Synthesizer. You are given an already-computed evidence_ledger and urgency — do not change or second-guess the numbers. Write a short executive_summary connecting the evidence into a clear rationale for the proposed action, for a human to approve or reject. You are not making the decision.
Respond with JSON only:
{"title":"string","executive_summary":"string","proposed_action":{"action_type":"string","target_entity_id":"string"},"required_human_signoff_role":"HR_EXECUTIVE|MANAGER"}`;

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
  const [twinsRes, reqsRes, graphRes, journeysRes, openRecsRes, obsRes] = await Promise.all([
    supabase.from("digital_twins").select("id, name, role, status, signals, performance_history, verified_skills, seniority_level, job_title, attendance, delivery, promotion_lag_months").eq("org_id", caller.org_id),
    supabase.from("job_requisitions").select("id, title, required_skills, future_skills, seniority_level").eq("org_id", caller.org_id),
    supabase.from("skill_graph").select("skill, category, outgoing_edges").eq("org_id", caller.org_id),
    supabase.from("onboarding_journeys").select("twin_id, status, tasks").eq("org_id", caller.org_id),
    supabase.from("recommendations").select("twin_id, category, status").eq("org_id", caller.org_id).in("status", ["needs_review", "approved", "dispatched"]),
    supabase.from("workforce_observations").select("twin_id, metric, period_start, value, missing").eq("org_id", caller.org_id),
  ]);

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
    journeys: journeysRes.data ?? [],
  });

  // Canonical stored category names (stable across seed + scan).
  const CATEGORY_DB: Record<string, string> = {
    RETENTION_INTERVENTION: "workforce_review",
    INTERNAL_MOBILITY: "mobility",
    ONBOARDING_REPLAN: "onboarding_replan",
    DEVELOPMENT_SUPPORT: "development_support",
  };

  // Dedup against already-open recommendations (same twin + category).
  const open = new Set((openRecsRes.data ?? []).map((r) => `${r.twin_id}|${r.category.toLowerCase()}`));
  const fresh = candidates.filter((c) => {
    const dbCat = CATEGORY_DB[c.category] ?? c.category.toLowerCase();
    return !open.has(`${c.twin_id}|${dbCat}`);
  });

  const now = new Date().toISOString();
  const created: RecCandidate[] = [];
  for (const c of fresh) {
    // ONE Qwen call per new recommendation — language only, never facts/urgency.
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

    const { error } = await supabase.from("recommendations").insert({
      org_id: caller.org_id,
      twin_id: c.twin_id,
      category: CATEGORY_DB[c.category] ?? c.category.toLowerCase(),
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
      status: "needs_review",
      // Sign-off comes from the deterministic engine — the model is not deciding.
      required_signoff_role: c.required_signoff_role,
      reviewer_rationale: {},
      audit_events: [{ actor: caller.email ?? uid, action: "created", note: `Triggered by intelligence scan (${c.category}).`, timestamp: now }],
    });
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    created.push(c);
  }

  return json({ ok: true, scanned_candidates: candidates.length, created: created.length, created_ids: created.map((c) => c.category) });
  } catch (err) {
    return json({ error: err instanceof QwenError ? err.code : "INTERNAL", message: err instanceof Error ? err.message : "unknown" });
  }
});