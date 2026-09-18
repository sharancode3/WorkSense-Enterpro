import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { buildCandidateComparison, type ReqCriterionView, type CompareRow } from "../_shared/candidate-compare.ts";

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
  if (!caller || !["hr_executive", "recruiter"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
  }

  let body: { req_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const reqId = (body.req_id ?? "").trim();
  if (!reqId) return json({ error: "VALIDATION_ERROR", message: "req_id is required." }, 400);

  const { data: reqRow, error: reqErr } = await supabase
    .from("job_requisitions")
    .select("id, org_id, title, required_skills, requisition_criteria, audit_events, applicants")
    .eq("id", reqId)
    .maybeSingle();
  if (reqErr || !reqRow) return json({ error: "NOT_FOUND", message: "Requisition not found." }, 404);
  if (reqRow.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  const applicants = ((reqRow.applicants ?? []) as { twin_id: string; stage: string; application_code: string; applied_at?: string; version?: number }[])
    .map((a) => ({
      twin_id: a.twin_id,
      stage: a.stage,
      version: a.version ?? 1,
      application_code: a.application_code,
      applied_at: a.applied_at ?? "",
    }))
    .filter((a) => a.stage !== "rejected" && a.stage !== "selected");

  // Applications table is the authoritative stage source when present.
  const appRows = applicants.length > 0
    ? await supabase
        .from("applications")
        .select("candidate_twin_id, stage, application_code, applied_at, version")
        .eq("requisition_id", reqId)
    : { data: [] as never[] };
  const appByTwin = new Map(
    ((appRows.data ?? []) as { candidate_twin_id: string; stage: string; application_code: string; applied_at: string; version: number }[])
      .map((a) => [a.candidate_twin_id, a])
  );

  const twinIds = applicants.map((a) => a.twin_id);
  const { data: twinRows } = twinIds.length > 0
    ? await supabase.from("digital_twins").select("id, name, email, computed_fits").in("id", twinIds)
    : { data: [] as never[] };

  const fits = new Map<string, { score: number; computed_at: string; classification?: unknown }>();
  for (const t of (twinRows ?? []) as { id: string; name: string; email: string | null; computed_fits?: unknown[] }[]) {
    const entry = (t.computed_fits ?? []).find(
      (f) =>
        (f as { target_type?: string; target_id?: string; scenario?: string }).target_type === "requisition" &&
        (f as { target_id?: string }).target_id === reqId &&
        (f as { scenario?: string }).scenario === "current"
    );
    if (entry) {
      fits.set(t.id, entry as { score: number; computed_at: string; classification?: unknown });
    }
  }

  const candidates = new Map(
    ((twinRows ?? []) as { id: string; name: string; email: string | null }[]).map((t) => [t.id, { id: t.id, name: t.name, email: t.email }])
  );

  const enrichedApplicants = applicants.map((a) => {
    const app = appByTwin.get(a.twin_id);
    return {
      ...a,
      stage: app?.stage ?? a.stage,
      version: app?.version ?? a.version,
      application_code: app?.application_code ?? a.application_code,
      applied_at: app?.applied_at ?? a.applied_at,
    };
  });

  const result = buildCandidateComparison({
    req: {
      id: reqRow.id,
      title: reqRow.title,
      audit_events: reqRow.audit_events ?? [],
      requisition_criteria: (reqRow.requisition_criteria ?? []) as ReqCriterionView[],
      required_skills: reqRow.required_skills ?? [],
    },
    applicants: enrichedApplicants,
    candidates,
    fits: fits as Map<string, { score: number; computed_at: string; classification?: { adjacent?: { skill: string }[]; transferable?: { skill: string }[]; gaps?: { skill: string }[] } }>,
  });

  return json({ ok: true, req_id: reqRow.id, req_title: reqRow.title, ...result });
});
