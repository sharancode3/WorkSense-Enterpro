import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  claimHash,
  computeFit,
  fitKey,
  fitIsStale,
  graphContentHash,
  personContextHash,
  requisitionContentHash,
  resolveFutureRequirements,
  authorizeSkillMatch,
  DEFAULT_EVIDENCE_THRESHOLD,
  evidenceDetailHash,
  type FitRecord,
  type RequiredSkill,
} from "../_shared/skill-graph-engine.ts";
import { resolveEvidenceArtifacts, resolveLineage, resolveSkillClaims, type AssertionRow, type EvidenceRow } from "../_shared/evidence.ts";

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

/** Team membership check (own row + reports subtree) via service-role reads,
 *  restricted to the caller's own organization. A failed lookup yields an
 *  empty tree, so it can never be mistaken for permission. */
async function isTeamMember(supabase, rootTwinId: string, rootOrgId: string, checkTwinId: string): Promise<boolean> {
  const { data } = await supabase
    .from("digital_twins")
    .select("id, org_id, manager_id")
    .eq("org_id", rootOrgId);
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

/**
 * Phase 9: per-requirement evidence detail for the engine — freshness of the
 * newest supporting assertion and the source artifact key. Both feed the
 * matrix and the fingerprint (via evidenceDetailHash on the raw lineage).
 */
function evidenceDetailFor(
  assertions: AssertionRow[],
  evidence: EvidenceRow[]
): Record<string, { captured_at?: string | null; artifact_key?: string | null }> {
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const artifactKey = (e: EvidenceRow) =>
    e.source_id ? `artifact:${e.source_type ?? "unknown"}|${e.source_id}` : `item:${e.id}`;
  const out: Record<string, { captured_at?: string | null; artifact_key?: string | null }> = {};
  for (const a of assertions) {
    const name = (a.skill_name ?? "").trim();
    if (!name) continue;
    const firstEvidence = (a.evidence_ids ?? [])
      .map((id) => evidenceById.get(id))
      .filter((e): e is EvidenceRow => Boolean(e));
    const newest = firstEvidence.length > 0
      ? firstEvidence.reduce((acc, e) => (!acc || (e.captured_at ?? "") > (acc.captured_at ?? "") ? e : acc))
      : undefined;
    const key = name.toLowerCase();
    const cur = out[key];
    const candCaptured = newest?.captured_at ?? a.created_at ?? null;
    const candArtifact = firstEvidence.length > 0 ? artifactKey(firstEvidence[0]) : null;
    if (!cur || (candCaptured ?? "") > (cur.captured_at ?? "")) {
      out[key] = { captured_at: candCaptured, artifact_key: candArtifact };
    }
  }
  return out;
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

  // Visibility (server-side; never decided on the client):
  const scope = authorizeSkillMatch({
    callerRole: caller.role,
    callerOrgId: caller.org_id,
    callerTwinId: caller.id,
    targetOrgId: targetTwin.org_id,
    targetTwinId: targetTwin.id,
    targetRole: targetTwin.role,
    targetIsInCallerTeam:
      caller.role === "manager" ? await isTeamMember(supabase, caller.id, caller.org_id, targetTwin.id) : false,
  });
  if (scope === "denied") {
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

  const currentSkills = (reqRow.required_skills ?? []) as RequiredSkill[];
  const futureSkills = (reqRow.future_skills ?? []) as RequiredSkill[];

  // Phase 9: the future scenario evaluates the RESOLVED 12–24 month target
  // (current still-relevant + additions + raised targets). Missing future
  // definition is handled by the caller (page): no fit is produced.
  const derivation = resolveFutureRequirements(currentSkills, futureSkills, []);
  const requiredSkills =
    scenario === "future" ? derivation.resolved : currentSkills;

  // Phase 9: the requisition fingerprint covers the normalized current AND
  // resolved-future sets (mandatory status, target, weight), plus seniority.
  const requisitionVersion = requisitionContentHash({
    current: currentSkills,
    future: futureSkills,
    resolvedFuture: derivation.resolved,
    seniorityLevel: reqRow.seniority_level ?? 3,
  });

  const claims = await resolveSkillClaims(supabase, { id: targetTwin.id, verified_skills: targetTwin.verified_skills });
  const lineage = await resolveLineage(supabase, targetTwin.id);
  const artifacts = await resolveEvidenceArtifacts(supabase, targetTwin.id);
  const evidenceDetail = evidenceDetailFor(lineage.assertions, lineage.evidence);
  // Phase 9: evidence fingerprint covers assertion ids, review states,
  // proficiency, artifact ids, captured_at/expiry.
  const evidenceVersion = evidenceDetailHash(lineage);

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
    engine: "3",
    evidence: evidenceVersion,
    requisition: requisitionVersion,
    graph: graphVersion,
    context: contextVersion,
    plan: "none",
  };

  // Cache: durable skill_fits row (atomic upsert => no concurrent
  // read-modify-write that could overwrite another stored result), with a
  // legacy fallback to twin.computed_fits.
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
    requiredSkills,
    roleLevel: reqRow.seniority_level ?? 3,
    skillGraph: graphRows ?? [],
    target: { type: "requisition", id: reqRow.id, title: reqRow.title },
    scenario,
    computedAt: now,
    evidenceArtifactCount: artifacts.count,
    evidenceDetail,
    evidenceVersion,
    requisitionVersion,
    planVersion: "none",
    derivation: scenario === "future" ? derivation : undefined,
  });

  // Durable write: atomic upsert.
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

  // Best-effort legacy mirror into twin.computed_fits.
  const key = fitKey(fit);
  const nextFits = fits.filter((f) => fitKey(f) !== key).concat(fit);
  const nextAudit = [
    ...(targetTwin.audit_events ?? []),
    {
      actor: caller.email ?? uid,
      action: scenario === "future" ? "match_future_computed" : "match_computed",
      note: `Match vs ${reqRow.title} (${scenario}): verified ${fit.score.toFixed(3)} · profile ${fit.profile_match.toFixed(3)} — engine v${fit.versions?.engine}, evidence ${fit.versions?.evidence ?? "?"}, requisition ${fit.versions?.requisition ?? "?"}.`,
      timestamp: now,
    },
  ];
  await supabase
    .from("digital_twins")
    .update({ computed_fits: nextFits, audit_events: nextAudit })
    .eq("id", targetTwin.id);

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
