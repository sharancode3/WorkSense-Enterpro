import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit } from "../_shared/skill-graph-engine.ts";
import { checkStale, resolveTransition, STAGE_ACTOR_ROLES } from "../_shared/stage-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !STAGE_ACTOR_ROLES.includes(caller.role as (typeof STAGE_ACTOR_ROLES)[number])) {
    return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
  }

  let body: {
    application_id?: string;
    decision?: string;
    reason?: string;
    expected_stage?: string;
    expected_version?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const applicationId = (body.application_id ?? "").trim();
  const decision = body.decision ?? "";
  if (!applicationId || !["move_forward", "reject", "select"].includes(decision)) {
    return json({ error: "VALIDATION_ERROR", message: "application_id and decision (move_forward|reject|select) are required." }, 400);
  }

  const { data: application } = await supabase
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .eq("org_id", caller.org_id)
    .maybeSingle();
  if (!application) return json({ error: "NOT_FOUND", message: "Application not found." }, 404);

  // Optimistic-concurrency: the caller must agree on stage AND version.
  const stale = checkStale(
    body.expected_stage ?? application.stage,
    body.expected_version ?? application.version,
    application.stage,
    application.version
  );
  if (stale.stale) {
    return json({
      error: "STALE_STATE",
      message: `Application moved since you loaded it (stage "${stale.currentStage}", version ${stale.currentVersion}). Refresh and retry.`,
      current_stage: stale.currentStage,
      current_version: stale.currentVersion,
    }, 409);
  }

  const transition = resolveTransition(application.stage, decision);
  if (transition.ok === false) {
    return json({ error: transition.code, message: transition.message }, transition.code === "STAGE_TERMINAL" ? 409 : 400);
  }
  const newStage = transition.newStage;
  const now = new Date().toISOString();
  const actor = caller.email ?? uid;

  // Select path: atomic conversion (mirrors recruiter-decision) + fit compute.
  let conversion: unknown = null;
  let fits: { current: number | null; future: number | null } = { current: null, future: null };
  if (decision === "select") {
    const { data: conv, error: convErr } = await supabase.rpc("convert_candidate_to_employee", {
      p_twin_id: application.candidate_twin_id,
      p_req_id: application.requisition_id,
    });
    if (convErr) return json({ error: "INTERNAL", message: convErr.message }, 500);
    conversion = conv;

    const { data: reqRow } = await supabase
      .from("job_requisitions")
      .select("id, title, required_skills, future_skills, seniority_level")
      .eq("id", application.requisition_id)
      .maybeSingle();
    const { data: twin } = await supabase
      .from("digital_twins")
      .select("id, org_id, verified_skills, seniority_level, computed_fits, audit_events")
      .eq("id", application.candidate_twin_id)
      .maybeSingle();
    if (reqRow && twin) {
      const { data: graphRows } = await supabase
        .from("skill_graph")
        .select("skill, category, outgoing_edges")
        .eq("org_id", caller.org_id);
      const fitCurrent = computeFit({
        candidateSkills: twin.verified_skills ?? [],
        candidateLevel: twin.seniority_level ?? 3,
        requiredSkills: reqRow.required_skills ?? [],
        roleLevel: reqRow.seniority_level ?? 3,
        skillGraph: graphRows ?? [],
        target: { type: "requisition", id: reqRow.id, title: reqRow.title },
        scenario: "current",
        computedAt: now,
      });
      const fitFuture = computeFit({
        candidateSkills: twin.verified_skills ?? [],
        candidateLevel: twin.seniority_level ?? 3,
        requiredSkills: reqRow.future_skills ?? [],
        roleLevel: reqRow.seniority_level ?? 3,
        skillGraph: graphRows ?? [],
        target: { type: "requisition", id: reqRow.id, title: reqRow.title },
        scenario: "future",
        computedAt: now,
      });
      const prev = (twin.computed_fits ?? []) as { target_id: string; scenario: string }[];
      await supabase
        .from("digital_twins")
        .update({
          computed_fits: [
            ...prev.filter((f) => !(f.target_id === reqRow.id && (f.scenario === "current" || f.scenario === "future"))),
            fitCurrent, fitFuture,
          ],
          audit_events: [
            ...(twin.audit_events ?? []),
            { actor, action: "conversion_fit_computed", note: `Role fit current ${fitCurrent.score.toFixed(2)} / future ${fitFuture.score.toFixed(2)} for ${reqRow.title}.`, timestamp: now },
          ],
        })
        .eq("id", twin.id);
      fits = { current: fitCurrent.score, future: fitFuture.score };
    }
  }

  // Update the authoritative applications row (versioned) + stage event.
  const nextVersion = (application.version ?? 1) + 1;
  const { data: updatedApp, error: appErr } = await supabase
    .from("applications")
    .update({ stage: newStage, version: nextVersion, updated_at: now })
    .eq("id", application.id)
    .eq("version", application.version)
    .select("id, stage, version")
    .single();
  if (appErr) {
    // The version guard should have held; report a conflict rather than clobber.
    const { data: cur } = await supabase.from("applications").select("stage, version").eq("id", application.id).single();
    return json({ error: "STALE_STATE", message: "The application changed concurrently.", current_stage: cur?.stage, current_version: cur?.version }, 409);
  }

  const reason = (body.reason ?? "").trim() || (decision === "move_forward" ? `Advanced to ${newStage.replace(/_/g, " ")}.` : decision === "select" ? "Candidate selected and converted to employee." : "Candidate rejected.");
  const auditRef = `stage:${application.id}:${application.version}`;
  const { error: evErr } = await supabase.from("application_stage_events").insert({
    org_id: caller.org_id,
    application_id: application.id,
    actor_twin_id: caller.id,
    prior_stage: application.stage,
    new_stage: newStage,
    reason,
    at: now,
    version: nextVersion,
    audit_ref: auditRef,
  });
  if (evErr) return json({ error: "INTERNAL", message: evErr.message }, 500);

  // Keep the legacy requisition applicants[] jsonb in sync (stage, code, score).
  const { data: reqRow } = await supabase
    .from("job_requisitions")
    .select("id, applicants, audit_events")
    .eq("id", application.requisition_id)
    .maybeSingle();
  if (reqRow) {
    const applicants = (reqRow.applicants ?? []) as { twin_id: string; stage: string; application_code?: string; match_score?: number | null }[];
    const nextApplicants = applicants.map((a) =>
      a.twin_id === application.candidate_twin_id ? { ...a, stage: newStage, application_code: a.application_code ?? application.application_code } : a
    );
    await supabase
      .from("job_requisitions")
      .update({
        applicants: nextApplicants,
        audit_events: [
          ...(reqRow.audit_events ?? []),
          { actor, action: `applicant_${newStage.replace("_", "_")}`, note: `${reason}`, timestamp: now },
        ],
      })
      .eq("id", reqRow.id);
  }

  const { data: events } = await supabase
    .from("application_stage_events")
    .select("id, prior_stage, new_stage, reason, at, version, actor_twin_id")
    .eq("application_id", application.id)
    .order("at", { ascending: true });

  return json({
    ok: true,
    application: updatedApp,
    decision,
    transition: { prior_stage: application.stage, new_stage: newStage },
    reason,
    version: nextVersion,
    conversion,
    fits,
    history: events ?? [],
  });
});
