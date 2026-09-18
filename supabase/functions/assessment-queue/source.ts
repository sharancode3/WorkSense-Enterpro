import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { buildAssessmentQueue, type AssessmentQueueResult, type QueueOwnerRole } from "../_shared/assessment-queue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Batch 5 (5.2): explicit allowlist. Managers/employees/IT/candidates are
// rejected server-side — the hiring queue is a recruitment-scope projection.
const ALLOWED_ROLES = new Set(["hr_executive", "hr_partner", "recruiter"]);

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
    .select("id, role, email, org_id, status")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);
  if (caller.status !== "active") {
    return json({ error: "FORBIDDEN", message: "This account is not active." }, 403);
  }
  if (!ALLOWED_ROLES.has(caller.role)) {
    return json({ error: "FORBIDDEN", message: "This role is not authorized to view the hiring work queue." }, 403);
  }

  const role: QueueOwnerRole = caller.role === "recruiter" ? "recruiter" : caller.role === "hr_executive" ? "hr_executive" : "hr_partner";
  const orgId = caller.org_id;

  // Canonical rows, scoped to the caller's organization (service role — RLS
  // does not apply here; the org scope + role allowlist below are the boundary).
  const [sessionsRes, appsRes, bpsRes, twinsRes, reqsRes, assessmentsRes, jobsRes] = await Promise.all([
    supabase.from("candidate_sessions").select("id, session_type, status, expires_at, submitted_at, created_at, application_id, blueprint_id").eq("org_id", orgId),
    supabase.from("applications").select("id, application_code, requisition_id, candidate_twin_id, org_id").eq("org_id", orgId),
    supabase.from("assessment_blueprints").select("id, artifact_spec").eq("org_id", orgId),
    supabase.from("digital_twins").select("id, name, email").eq("org_id", orgId).eq("role", "candidate"),
    supabase.from("job_requisitions").select("id, title").eq("org_id", orgId),
    supabase.from("assessments").select("id, twin_id, requisition_id, type, created_at, reviewed_at, result").eq("org_id", orgId),
    supabase.from("model_jobs").select("id, task, status, error_code, error_message, created_at, finished_at, output").eq("org_id", orgId).eq("task", "assessment_evaluation"),
  ]);

  const queue = buildAssessmentQueue({
    orgId,
    clock: new Date().toISOString(),
    sessions: (sessionsRes.data ?? []) as never,
    applications: (appsRes.data ?? []) as never,
    blueprints: (bpsRes.data ?? []) as never,
    twins: (twinsRes.data ?? []) as never,
    requisitions: (reqsRes.data ?? []) as never,
    assessments: (assessmentsRes.data ?? []) as never,
    jobs: (jobsRes.data ?? []) as never,
  });

  return json({ ok: true, role, ...queue } satisfies { ok: true; role: QueueOwnerRole } & AssessmentQueueResult);
});
