import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  claimHash,
  computeFit,
  fitKey,
  fitIsStale,
  graphContentHash,
  personContextHash,
  requisitionContentHash,
  DEFAULT_EVIDENCE_THRESHOLD,
  type FitRecord,
} from "../_shared/skill-graph-engine.ts";
import { resolveEvidenceArtifacts, resolveLineage, resolveSkillClaims } from "../_shared/evidence.ts";

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
    return jsonResponse({ error: "VALIDATION_ERROR", message: "twin_id and target_id are required." }, 400);
  }

  // Identity + role check (server-side; never decided on the client).
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return jsonResponse({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller, error: callerErr } = await supabase
    .from("digital_twins")
    .select("id, org_id, role, name, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (callerErr || !caller) return jsonResponse({ error: "UNAUTHENTICATED" }, 401);

  const { data: targetTwin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, org_id, role, name, verified_skills, seniority_level, computed_fits, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !targetTwin) {
    return jsonResponse({ error: "NOT_FOUND", message: "DigitalTwin not found." }, 404);
  }

  // Visibility: HR (same org) sees anyone; recruiter sees candidates (their
  // core workflow — the Fit card in the Recruitment Studio); manager sees own
  // team; employee self.
  let allowed = false;
  let scope: "org" | "candidates" | "team" | "self";
  if (caller.role === "hr_executive" && caller.org_id === targetTwin.org_id) {
    allowed = true;
    scope = "org";
  } else if (caller.role === "recruiter" && caller.org_id === targetTwin.org_id && targetTwin.role === "candidate") {
    allowed = true;
    scope = "candidates";
  } else if (caller.role === "manager" || caller.role === "employee") {
    allowed = targetTwin.id === caller.id || (await isTeamMember(supabase, caller.id, targetTwin.id));
    scope = targetTwin.id === caller.id ? "self" : "team";
  } else {
    scope = "org";
  }
  if (!allowed) {
    return jsonResponse({ error: "FORBIDDEN", message: "You may only view matches for yourself, your team, or authorized candidates." }, 403);
  }

  const { data: reqRow, error: reqErr } = await supabase
    .from("job_requisitions")
    .select("id, org_id, title, required_skills, future_skills, seniority_level")
    .eq("id", targetId)
    .maybeSingle();
  if (reqErr || !reqRow) {
    return jsonResponse({ error: "NOT_FOUND", message: "Requisition not found." }, 404);
  }
  if (reqRow.org_id !== caller.org_id) {
    return jsonResponse({ error: "FORBIDDEN" }, 403);
  }

  const requiredSkills = scenario === "future" ? reqRow.future_skills : reqRow.required_skills;
  const requisitionVersion = requisitionContentHash(
    reqRow.required_skills ?? [],
    reqRow.future_skills ?? [],
    reqRow.seniority_level ?? 3
  );

  const claims = await resolveSkillClaims(supabase, { id: targetTwin.id, verified_skills: targetTwin.verified_skills });
  const artifacts = await resolveEvidenceArtifacts(supabase, targetTwin.id);

  // Batch E (E3): the full fingerprint — engine, claims (skills/proficiency/
  // review state), requisition content + seniority, the graph relationships,
  // and the person-level context (seniority + independent artifact count).
  const { data: graphRows, error: graphErr } = await supabase
    .from("skill_graph")
    .select("skill, category, outgoing_edges")
    .eq("org_id", caller.org_id);
  if (graphErr) throw graphErr;
  const graphVersion = graphContentHash(graphRows ?? []);
  const contextVersion = personContextHash(
    targetTwin.seniority_level ?? 3,
    artifacts.count,
    claims.length
  );
  const current = {
    engine: "2",
    evidence: claimHash(claims),
    requisition: requisitionVersion,
    graph: graphVersion,
    context: contextVersion,
  };

  // Cache: durable skill_fits row (atomic upsert => no concurrent
  // read-modify-write that could overwrite another stored result), with a
  // legacy fallback to twin.computed_fits. Recompute only when missing, stale
  // (engine / evidence / requisition / graph / context changed) or force.
  const { data: storedRows } = await supabase
    .from("skill_fits")
    .select("fit")
    .eq("org_id", caller.org_id)
    .eq("twin_id", twinId)
    .eq("target_type", "requisition")
    .eq("target_id", targetId)
    .eq("scenario", scenario)
    .maybeSingle();
  const fits: FitRecord[] = (targetTwin.computed_fits ?? []) as FitRecord[];
  const legacyFit = fits.find(
    (f) => f.target_type === "requisition" && f.target_id === targetId && f.scenario === scenario
  );
  const cached: FitRecord | null = (storedRows?.fit as FitRecord | undefined) ?? legacyFit ?? null;

  const stale = fitIsStale(cached, current);

  if (cached && !body.force && !stale) {
    const lineage = await resolveLineage(supabase, targetTwin.id);
    return jsonResponse({
      ok: true,
      cached: true,
      scope,
      person: { id: targetTwin.id, name: targetTwin.name, role: targetTwin.role },
      fit: cached,
      lineage,
      evidence_artifacts: artifacts,
    });
  }

  const now = new Date().toISOString();
  const fit = computeFit({
    candidateSkills: claims,
    candidateLevel: targetTwin.seniority_level ?? 3,
    requiredSkills: requiredSkills ?? [],
    roleLevel: reqRow.seniority_level ?? 3,
    skillGraph: graphRows ?? [],
    target: { type: "requisition", id: reqRow.id, title: reqRow.title },
    scenario,
    computedAt: now,
    evidenceArtifactCount: artifacts.count,
    requisitionVersion,
  });

  // Durable write: atomic upsert — two concurrent recomputes for different
  // targets both persist; nothing is lost (no read-modify-write on an array).
  const { error: upErr } = await supabase
    .from("skill_fits")
    .upsert(
      {
        org_id: caller.org_id,
        twin_id: twinId,
        target_type: "requisition",
        target_id: targetId,
        scenario,
        fit,
        computed_at: now,
      },
      { onConflict: "twin_id,target_type,target_id,scenario" }
    );
  if (upErr) throw upErr;

  // Best-effort legacy mirror into twin.computed_fits (same key replaced,
  // other keys preserved). The durable source of truth is skill_fits.
  const key = fitKey(fit);
  const nextFits = fits.filter((f) => fitKey(f) !== key).concat(fit);
  const nextAudit = [
    ...(targetTwin.audit_events ?? []),
    {
      actor: caller.email ?? uid,
      action: scenario === "future" ? "match_future_computed" : "match_computed",
      note: `Match vs ${reqRow.title} (${scenario}): ${fit.score.toFixed(3)} — engine v${fit.versions?.engine}, evidence ${fit.versions?.evidence ?? "?"}, requisition ${fit.versions?.requisition ?? "?"}.`,
      timestamp: now,
    },
  ];
  await supabase
    .from("digital_twins")
    .update({ computed_fits: nextFits, audit_events: nextAudit })
    .eq("id", targetTwin.id);

  const lineage = await resolveLineage(supabase, targetTwin.id);
  return jsonResponse({
    ok: true,
    cached: false,
    scope,
    person: { id: targetTwin.id, name: targetTwin.name, role: targetTwin.role },
    fit,
    lineage,
    evidence_artifacts: artifacts,
  });
});
