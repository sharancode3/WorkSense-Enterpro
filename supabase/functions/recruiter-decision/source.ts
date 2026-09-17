import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit } from "../_shared/skill-graph-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STAGE_ORDER = ["screening", "technical_interview", "final_round"] as const;
type Stage = (typeof STAGE_ORDER)[number];

function nextStage(stage: string): string | null {
  const i = STAGE_ORDER.indexOf(stage as Stage);
  if (i === -1 || i === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[i + 1];
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
  if (!uid) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !["hr_executive", "recruiter"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
  }

  let body: { twin_id?: string; req_id?: string; decision?: string; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }

  const twinId = (body.twin_id ?? "").trim();
  const reqId = (body.req_id ?? "").trim();
  const decision = body.decision ?? "";
  if (!twinId || !reqId || !["move_forward", "reject", "select"].includes(decision)) {
    return json({ error: "BAD_REQUEST", message: "twin_id, req_id and decision (move_forward|reject|select) are required." }, 400);
  }

  const { data: twin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, role, status, name, org_id, verified_skills, seniority_level, computed_fits, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !twin) return json({ error: "NOT_FOUND", message: "Candidate not found." }, 404);

  const { data: reqRow, error: reqErr } = await supabase
    .from("job_requisitions")
    .select("id, org_id, title, required_skills, future_skills, seniority_level, applicants, audit_events")
    .eq("id", reqId)
    .maybeSingle();
  if (reqErr || !reqRow) return json({ error: "NOT_FOUND", message: "Requisition not found." }, 404);
  if (reqRow.org_id !== twin.org_id || reqRow.org_id !== caller.org_id) {
    return json({ error: "FORBIDDEN" }, 403);
  }

  const applicants = (reqRow.applicants ?? []) as { twin_id: string; stage: string }[];
  const idx = applicants.findIndex((a) => a.twin_id === twinId);
  if (idx === -1) return json({ error: "NOT_FOUND", message: "Applicant is not on this requisition." }, 404);

  const now = new Date().toISOString();
  const actor = caller.email ?? uid;
  let newStage: string;
  let note: string;

  if (decision === "select") {
    // Atomic conversion via DB function (single transaction, preserves pre-hire data).
    const { data: conv, error: convErr } = await supabase.rpc("convert_candidate_to_employee", {
      p_twin_id: twinId,
      p_req_id: reqId,
    });
    if (convErr) return json({ error: "CONVERSION_FAILED", message: convErr.message }, 500);

    // Requirement: on conversion, compute the Fit against the role's required
    // AND future skills, persist into computed_fits[] + audit.
    const { data: graphRows } = await supabase
      .from("skill_graph")
      .select("skill, category, outgoing_edges")
      .eq("org_id", twin.org_id);
    const fits = (twin.computed_fits ?? []) as { target_id: string; scenario: string }[];
    const fitCurrent = computeFit({
      candidateSkills: twin.verified_skills ?? [],
      candidateLevel: twin.seniority_level ?? 3,
      requiredSkills: reqRow.required_skills ?? [],
      roleLevel: reqRow.seniority_level ?? 3,
      skillGraph: graphRows ?? [],
      target: { type: "requisition", id: reqRow.id, title: reqRow.title },
      scenario: "current",
    });
    const fitFuture = computeFit({
      candidateSkills: twin.verified_skills ?? [],
      candidateLevel: twin.seniority_level ?? 3,
      requiredSkills: reqRow.future_skills ?? [],
      roleLevel: reqRow.seniority_level ?? 3,
      skillGraph: graphRows ?? [],
      target: { type: "requisition", id: reqRow.id, title: reqRow.title },
      scenario: "future",
    });
    const now = new Date().toISOString();
    const nextFits = fits
      .filter((f) => !(f.target_id === reqRow.id && (f.scenario === "current" || f.scenario === "future")))
      .concat([fitCurrent, fitFuture] as unknown as { target_id: string; scenario: string }[]);
    await supabase
      .from("digital_twins")
      .update({
        computed_fits: nextFits,
        audit_events: [
          ...(twin.audit_events ?? []),
          { actor: caller.email ?? uid, action: "conversion_fit_computed", note: `Role fit current ${fitCurrent.score.toFixed(2)} / future ${fitFuture.score.toFixed(2)} for ${reqRow.title}.`, timestamp: now },
        ],
      })
      .eq("id", twinId);

    return json({
      ok: true,
      decision: "select",
      converted: conv,
      applicant: { twin_id: twinId, stage: "selected" },
      fits: { current: fitCurrent.score, future: fitFuture.score },
      note: `Candidate selected and converted to employee for ${reqRow.title}.`,
    });
  }

  if (decision === "reject") {
    newStage = "rejected";
    note = body.note ?? "Candidate rejected.";
  } else {
    const next = nextStage(applicants[idx].stage);
    if (!next) {
      return json({ error: "BAD_REQUEST", message: "Candidate is already in the final round; select or reject instead." }, 400);
    }
    newStage = next;
    note = body.note ?? `Moved forward to ${newStage.replace(/_/g, " ")}.`;
  }

  const nextApplicants = applicants.map((a, i) => (i === idx ? { ...a, stage: newStage } : a));
  const nextAudit = [
    ...(reqRow.audit_events ?? []),
    { actor, action: "applicant_" + newStage.replace("_", "_"), note: `${twin.name}: ${note}`, timestamp: now },
  ];

  const { error: updateErr } = await supabase
    .from("job_requisitions")
    .update({ applicants: nextApplicants, audit_events: nextAudit })
    .eq("id", reqId);
  if (updateErr) return json({ error: "UPDATE_FAILED", message: updateErr.message }, 500);

  return json({ ok: true, decision, applicant: { twin_id: twinId, stage: newStage }, note });
});
