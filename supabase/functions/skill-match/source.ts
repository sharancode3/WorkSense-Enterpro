import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit, fitKey, DEFAULT_EVIDENCE_THRESHOLD, type FitRecord } from "../_shared/skill-graph-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Team membership check (own row + reports subtree) via service-role reads. */
async function isTeamMember(supabase, rootTwinId: string, checkTwinId: string): Promise<boolean> {
  const { data } = await supabase.from("digital_twins").select("id, manager_id");
  const children = new Map<string, string[]>();
  for (const t of data ?? []) {
    if (t.manager_id) {
      children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
    }
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

  let body: { twin_id?: string; target_id?: string; scenario?: "current" | "future"; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }

  const twinId = (body.twin_id ?? "").trim();
  const targetId = (body.target_id ?? "").trim();
  const scenario = body.scenario === "future" ? "future" : "current";
  if (!twinId || !targetId) {
    return jsonResponse({ error: "BAD_REQUEST", message: "twin_id and target_id are required." }, 400);
  }

  // Identity + role check (server-side; never decided on the client).
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return jsonResponse({ error: "UNAUTHORIZED" }, 401);

  const { data: caller, error: callerErr } = await supabase
    .from("digital_twins")
    .select("id, org_id, role")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (callerErr || !caller) return jsonResponse({ error: "UNAUTHORIZED" }, 401);

  const { data: targetTwin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, org_id, role, verified_skills, seniority_level, computed_fits, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !targetTwin) {
    return jsonResponse({ error: "NOT_FOUND", message: "DigitalTwin not found." }, 404);
  }

  // Visibility: HR (same org) sees anyone; manager sees own team; employee self.
  let allowed = false;
  if (caller.role === "hr_executive" && caller.org_id === targetTwin.org_id) allowed = true;
  else if (caller.role === "manager" || caller.role === "employee") {
    allowed = targetTwin.id === caller.id || (await isTeamMember(supabase, caller.id, targetTwin.id));
  }
  if (!allowed) {
    return jsonResponse({ error: "FORBIDDEN", message: "You may only view matches for yourself or your team." }, 403);
  }

  const { data: reqRow, error: reqErr } = await supabase
    .from("job_requisitions")
    .select("id, org_id, title, required_skills, future_skills, seniority_level, audit_events")
    .eq("id", targetId)
    .maybeSingle();
  if (reqErr || !reqRow) {
    return jsonResponse({ error: "NOT_FOUND", message: "Requisition not found." }, 404);
  }
  if (reqRow.org_id !== caller.org_id) {
    return jsonResponse({ error: "FORBIDDEN" }, 403);
  }

  const requiredSkills = scenario === "future" ? reqRow.future_skills : reqRow.required_skills;

  // Cache: reuse a fresh persisted fit; recompute only when missing or stale
  // (requisition requirements changed after computation) or force requested.
  const fits: FitRecord[] = (targetTwin.computed_fits ?? []) as FitRecord[];
  const cached = fits.find(
    (f) => f.target_type === "requisition" && f.target_id === targetId && f.scenario === scenario
  );
  const stale =
    (reqRow.audit_events ?? []).some(
      (a: { timestamp?: string }) =>
        cached && new Date(a.timestamp ?? 0).getTime() > new Date(cached.computed_at).getTime()
    ) || false;

  if (cached && !body.force && !stale) {
    return jsonResponse({ ok: true, cached: true, fit: cached });
  }

  const { data: graphRows, error: graphErr } = await supabase
    .from("skill_graph")
    .select("skill, category, outgoing_edges")
    .eq("org_id", caller.org_id);
  if (graphErr) throw graphErr;

  const now = new Date().toISOString();
  const fit = computeFit({
    candidateSkills: targetTwin.verified_skills ?? [],
    candidateLevel: targetTwin.seniority_level ?? 3,
    requiredSkills: requiredSkills ?? [],
    roleLevel: reqRow.seniority_level ?? 3,
    skillGraph: graphRows ?? [],
    target: { type: "requisition", id: reqRow.id, title: reqRow.title },
    scenario,
    computedAt: now,
  });

  // Persist: replace any same-key entry and append an audit event.
  const key = fitKey(fit);
  const nextFits = fits.filter((f) => fitKey(f) !== key).concat(fit);
  const nextAudit = [
    ...(targetTwin.audit_events ?? []),
    {
      actor: caller.email ?? uid,
      action: scenario === "future" ? "match_future_computed" : "match_computed",
      note: `Match vs ${reqRow.title} (${scenario}): ${fit.score.toFixed(3)} — viewed in a decision context.`,
      timestamp: now,
    },
  ];

  const { error: updateErr } = await supabase
    .from("digital_twins")
    .update({ computed_fits: nextFits, audit_events: nextAudit })
    .eq("id", targetTwin.id);
  if (updateErr) throw updateErr;

  return jsonResponse({ ok: true, cached: false, fit });
});
