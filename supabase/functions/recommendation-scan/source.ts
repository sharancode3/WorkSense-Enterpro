import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { scanForRecommendations, type RecCandidate } from "../_shared/recommendation-engine.ts";
import { callQwen } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUMMARY_SYSTEM = `You are a workforce decision synthesis writer.
Given an evidence ledger (facts already computed deterministically — never add, remove or alter facts) and an urgency label, write:
{"executive_summary":"2-3 sentences synthesizing the situation from the evidence only","recommended_action":"one concrete sentence"}
Never compute scores, never invent facts, never use the word 'prediction' about people leaving.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, org_id, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !["hr_executive", "hr_partner"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "HR access required to run the intelligence scan." }, 403);
  }

  // Load the org's data sources.
  const [twinsRes, reqsRes, graphRes, journeysRes, openRecsRes] = await Promise.all([
    supabase.from("digital_twins").select("id, name, role, status, signals, performance_history, verified_skills, seniority_level, job_title").eq("org_id", caller.org_id),
    supabase.from("job_requisitions").select("id, title, required_skills, future_skills, seniority_level").eq("org_id", caller.org_id),
    supabase.from("skill_graph").select("skill, category, outgoing_edges").eq("org_id", caller.org_id),
    supabase.from("onboarding_journeys").select("twin_id, status, tasks").eq("org_id", caller.org_id),
    supabase.from("recommendations").select("twin_id, category, status").eq("org_id", caller.org_id).in("status", ["needs_review", "approved", "dispatched"]),
  ]);

  const candidates = scanForRecommendations({
    twins: twinsRes.data ?? [],
    requisitions: reqsRes.data ?? [],
    graph: graphRes.data ?? [],
    journeys: journeysRes.data ?? [],
  });

  // Canonical stored category names (stable across seed + scan).
  const CATEGORY_DB: Record<string, string> = {
    RETENTION_INTERVENTION: "workforce_review",
    INTERNAL_MOBILITY: "mobility",
    ONBOARDING_REPLAN: "onboarding_replan",
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
      user: `Category: ${c.category}\nUrgency: ${c.urgency}\nEvidence ledger:\n${JSON.stringify(c.evidence_ledger, null, 2)}\nWrite the executive summary JSON.`,
    })) as { executive_summary?: string; recommended_action?: string };

    const { error } = await supabase.from("recommendations").insert({
      org_id: caller.org_id,
      twin_id: c.twin_id,
      category: CATEGORY_DB[c.category] ?? c.category.toLowerCase(),
      urgency: c.urgency,
      evidence_ledger: c.evidence_ledger,
      proposed_action: {
        ...c.proposed_action,
        executive_summary: parsed.executive_summary ?? "",
        recommended_action: parsed.recommended_action ?? c.proposed_action.title,
      },
      executive_summary: parsed.executive_summary ?? "",
      status: "needs_review",
      required_signoff_role: c.required_signoff_role,
      reviewer_rationale: {},
      audit_events: [{ actor: caller.email ?? uid, action: "created", note: `Triggered by intelligence scan (${c.category}).`, timestamp: now }],
    });
    if (error) return json({ error: "INSERT_FAILED", message: error.message }, 500);
    created.push(c);
  }

  return json({ ok: true, scanned_candidates: candidates.length, created: created.length, created_ids: created.map((c) => c.category) });
});
