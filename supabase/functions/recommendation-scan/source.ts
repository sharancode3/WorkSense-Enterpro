import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { scanForRecommendations, type RecCandidate } from "../_shared/recommendation-engine.ts";
import { callQwen } from "../_shared/qwen.ts";

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
    if (error) return json({ error: "INSERT_FAILED", message: error.message }, 500);
    created.push(c);
  }

  return json({ ok: true, scanned_candidates: candidates.length, created: created.length, created_ids: created.map((c) => c.category) });
});
