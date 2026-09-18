import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { hashInput } from "../_shared/jobs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ROLE_GATE = ["hr_executive", "recruiter"];

/** Canonical JSON: recursively sorts object keys so the same content hashes identically. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function resolveCaller(supabase, req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return null;
  const { data: twin } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  return twin ?? null;
}

/** Public token resolution: the session row carries the org. */
async function loadSessionByToken(supabase, token: string) {
  if (!token) return null;
  const { data, error } = await supabase
    .from("candidate_sessions")
    .select("*")
    .eq("invitation_token", token)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/** Expire a session in place when the deadline passed (before any candidate write). */
async function expireIfPast(supabase, session: { id: string; status: string; expires_at: string }) {
  if (session.status !== "submitted" && new Date(session.expires_at).getTime() < Date.now()) {
    const { data } = await supabase
      .from("candidate_sessions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", session.id)
      .select("*")
      .single();
    return data;
  }
  return session;
}

async function loadBlueprint(supabase, blueprintId: string) {
  const { data } = await supabase.from("assessment_blueprints").select("*").eq("id", blueprintId).maybeSingle();
  return data;
}

async function loadApplication(supabase, applicationId: string) {
  const { data } = await supabase.from("applications").select("*").eq("id", applicationId).maybeSingle();
  return data;
}

/** Candidate-safe session view (never evaluation, rubrics, or reviewer data). */
function candidateView(session: unknown, blueprint: { artifact_spec?: Record<string, unknown> } | null) {
  const s = session as Record<string, unknown>;
  const spec = (blueprint?.artifact_spec ?? {}) as {
    title?: string;
    instructions?: string;
    time_policy?: string;
    questions?: unknown[];
  };
  return {
    id: s.id,
    session_type: s.session_type,
    status: s.status,
    expires_at: s.expires_at,
    time_policy: s.time_policy ?? spec.time_policy ?? "",
    accommodation: s.accommodation ?? {},
    submitted_at: s.submitted_at ?? null,
    submission_hash: s.submission_hash ?? null,
    answers: s.answers ?? {},
    drafts: s.drafts ?? {},
    follow_ups: s.follow_ups ?? [],
    blueprint: {
      title: spec.title ?? "",
      instructions: spec.instructions ?? "",
      questions: spec.questions ?? [],
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: {
    action?: string;
    application_id?: string;
    blueprint_id?: string;
    session_type?: string;
    expires_in_hours?: number;
    token?: string;
    session_id?: string;
    drafts?: Record<string, unknown>;
    answers?: Record<string, unknown>;
    accommodation?: Record<string, unknown>;
    follow_ups?: { key: string; prompt: string }[];
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const action = body.action ?? "";

  // ---- Reviewer/recruiter actions (authenticated) -------------------------
  if (action === "create") {
    const caller = await resolveCaller(supabase, req);
    if (!caller || !ROLE_GATE.includes(caller.role)) return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);

    const applicationId = (body.application_id ?? "").trim();
    const blueprintId = (body.blueprint_id ?? "").trim();
    const sessionType = body.session_type ?? "";
    if (!applicationId || !blueprintId || !["work_sample", "interview"].includes(sessionType)) {
      return json({ error: "VALIDATION_ERROR", message: "application_id, blueprint_id and session_type (work_sample|interview) are required." }, 400);
    }

    const application = await loadApplication(supabase, applicationId);
    if (!application || application.org_id !== caller.org_id) return json({ error: "NOT_FOUND" }, 404);
    if (application.stage === "selected" || application.stage === "rejected") {
      return json({ error: "VALIDATION_ERROR", message: "Cannot invite a candidate whose application is closed." }, 400);
    }
    const blueprint = await loadBlueprint(supabase, blueprintId);
    if (!blueprint || blueprint.org_id !== caller.org_id || blueprint.requisition_id !== application.requisition_id) {
      return json({ error: "VALIDATION_ERROR", message: "Blueprint does not belong to this application's requisition." }, 400);
    }

    const hours = Math.min(24 * 7, Math.max(1, Number(body.expires_in_hours) || 72));
    const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
    const token = crypto.randomUUID();

    const { data: session, error } = await supabase
      .from("candidate_sessions")
      .insert({
        org_id: caller.org_id,
        application_id: application.id,
        twin_id: application.candidate_twin_id,
        blueprint_id: blueprintId,
        rubric_id: null,
        session_type: sessionType,
        invitation_token: token,
        status: "invited",
        expires_at: expiresAt,
        time_policy: ((blueprint.artifact_spec as { time_policy?: string })?.time_policy ?? null),
        accommodation: {},
        answers: {},
        drafts: {},
        follow_ups: [],
      })
      .select("*")
      .single();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);

    return json({
      ok: true,
      session: candidateView(session, blueprint),
      invitation_token: token,
      expires_at: session.expires_at,
    });
  }

  if (action === "fetch") {
    const sessionId = (body.session_id ?? "").trim();
    const token = (body.token ?? "").trim();

    // Reviewer fetch: authenticated + org-scoped.
    if (sessionId && !token) {
      const caller = await resolveCaller(supabase, req);
      if (!caller || !ROLE_GATE.includes(caller.role)) return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
      const { data: session } = await supabase
        .from("candidate_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("org_id", caller.org_id)
        .maybeSingle();
      if (!session) return json({ error: "NOT_FOUND" }, 404);
      const blueprint = await loadBlueprint(supabase, session.blueprint_id);
      const application = await loadApplication(supabase, session.application_id);
      const { data: rubrics } = blueprint
        ? await supabase.from("assessment_rubrics").select("*").eq("org_id", caller.org_id).eq("blueprint_id", blueprint.id)
        : { data: [] };
      const { data: evals } = await supabase
        .from("assessments")
        .select("*")
        .eq("org_id", caller.org_id)
        .eq("twin_id", session.twin_id)
        .eq("requisition_id", application?.requisition_id ?? "__none__");
      const evaluation = (evals ?? []).find((a) => (a.result as { session_id?: string })?.session_id === session.id) ?? null;
      const twin = application
        ? (await supabase.from("digital_twins").select("id, name, email").eq("id", session.twin_id).maybeSingle()).data
        : null;
      return json({
        ok: true,
        session: {
          ...candidateView(session, blueprint),
          invitation_token: session.invitation_token,
          blueprint: {
            ...candidateView(session, blueprint).blueprint,
            test_cases: blueprint?.test_cases ?? [],
          },
          candidate: twin,
          application_code: application?.application_code ?? null,
          requisition_id: application?.requisition_id ?? null,
        },
        rubrics: rubrics ?? [],
        evaluation,
      });
    }

    // Candidate fetch: public, token-scoped.
    const session = await loadSessionByToken(supabase, token);
    if (!session) return json({ error: "NOT_FOUND", message: "Invitation not found." }, 404);
    const blueprint = await loadBlueprint(supabase, session.blueprint_id);
    const live = await expireIfPast(supabase, session);
    return json({ ok: true, session: candidateView(live, blueprint) });
  }

  if (action === "resume") {
    // Reviewer issues one bounded follow-up round after a submission.
    const caller = await resolveCaller(supabase, req);
    if (!caller || !ROLE_GATE.includes(caller.role)) return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
    const sessionId = (body.session_id ?? "").trim();
    const followUps = (body.follow_ups ?? []).slice(0, 2);
    if (!sessionId) return json({ error: "VALIDATION_ERROR", message: "session_id is required." }, 400);
    if (followUps.length === 0 || followUps.some((f) => !f.key || !f.prompt || f.prompt.trim().length < 10)) {
      return json({ error: "VALIDATION_ERROR", message: "Provide 1–2 follow-up questions (each at least 10 characters)." }, 400);
    }
    const { data: session } = await supabase
      .from("candidate_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("org_id", caller.org_id)
      .maybeSingle();
    if (!session) return json({ error: "NOT_FOUND" }, 404);
    if (session.status !== "submitted") return json({ error: "CONFLICT", message: "Only a submitted session can be reopened for follow-ups." }, 409);
    if ((session.follow_ups ?? []).length > 0) {
      return json({ error: "CONFLICT", message: "A follow-up round was already issued — the session is bounded to one round." }, 409);
    }
    const keyed = followUps.map((f, i) => ({ key: `qf${i + 1}`, prompt: f.prompt, source: f.key ?? "follow_up" }));
    const { data: updated } = await supabase
      .from("candidate_sessions")
      .update({ status: "in_progress", follow_ups: [...(session.follow_ups ?? []), ...keyed], updated_at: new Date().toISOString() })
      .eq("id", session.id)
      .select("*")
      .single();
    return json({ ok: true, session: candidateView(updated, await loadBlueprint(supabase, updated.blueprint_id)), follow_ups_issued: keyed.length });
  }

  // ---- Candidate actions (public, invitation-token scoped) -----------------
  if (action === "draft") {
    const token = (body.token ?? "").trim();
    const session = await loadSessionByToken(supabase, token);
    if (!session) return json({ error: "NOT_FOUND", message: "Invitation not found." }, 404);
    const live = await expireIfPast(supabase, session);
    if (live.status === "expired") return json({ error: "SESSION_EXPIRED", message: "This invitation has expired." }, 410);
    if (live.status === "submitted") return json({ error: "LOCKED", message: "This session was already submitted and is locked." }, 409);
    if (live.status === "cancelled") return json({ error: "CONFLICT", message: "This session was cancelled." }, 409);

    const drafts = body.drafts ?? {};
    const accommodation = body.accommodation ?? {};
    const { data: updated } = await supabase
      .from("candidate_sessions")
      .update({
        drafts,
        accommodation,
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", live.id)
      .select("drafts, accommodation, status, updated_at")
      .single();
    return json({ ok: true, saved_at: updated?.updated_at ?? new Date().toISOString(), status: updated?.status ?? "in_progress" });
  }

  if (action === "submit") {
    const token = (body.token ?? "").trim();
    const session = await loadSessionByToken(supabase, token);
    if (!session) return json({ error: "NOT_FOUND", message: "Invitation not found." }, 404);
    const live = await expireIfPast(supabase, session);
    if (live.status === "expired") return json({ error: "SESSION_EXPIRED", message: "This invitation has expired." }, 410);
    if (live.status === "cancelled") return json({ error: "CONFLICT", message: "This session was cancelled." }, 409);

    const answers = body.answers ?? {};
    if (Object.keys(answers).length === 0) {
      return json({ error: "VALIDATION_ERROR", message: "Submit at least one answer." }, 400);
    }
    const submissionHash = hashInput(canonicalJson(answers));
    const accommodation = body.accommodation ?? live.accommodation ?? {};

    if (live.status === "submitted") {
      if (live.submission_hash === submissionHash) {
        return json({ error: "DUPLICATE_SUBMISSION", message: "These exact answers were already submitted." }, 409);
      }
      return json({ error: "LOCKED", message: "This session is already submitted and cannot be changed." }, 409);
    }

    const { data: updated, error } = await supabase
      .from("candidate_sessions")
      .update({
        answers,
        drafts: {},
        accommodation,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        submission_hash: submissionHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", live.id)
      .select("*")
      .single();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);

    return json({
      ok: true,
      submitted_at: updated.submitted_at,
      submission_hash: updated.submission_hash,
      status: updated.status,
    });
  }

  return json({ error: "VALIDATION_ERROR", message: "action must be create, fetch, resume, draft or submit." }, 400);
});
