import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function genCode() {
  return `WS-${Math.random().toString(36).slice(2, 7).toUpperCase()}-2026`;
}

function skillsEqual(a: { skill: string; target_proficiency?: number }[] | undefined, b: { skill: string; target_proficiency?: number }[] | undefined): boolean {
  const norm = (arr?: { skill: string; target_proficiency?: number }[]) =>
    (arr ?? []).map((s) => `${s.skill.toLowerCase()}:${s.target_proficiency ?? 0}`).sort().join(",");
  return norm(a) === norm(b);
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
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !["hr_executive", "recruiter"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
  }

  let body: {
    action?: string;
    req_id?: string;
    title?: string;
    department?: string;
    seniority_level?: number;
    required_skills?: { skill: string; target_proficiency: number }[];
    future_skills?: { skill: string; target_proficiency: number }[];
    twin_id?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const action = body.action ?? "";
  const now = new Date().toISOString();

  if (action === "create") {
    const title = (body.title ?? "").trim();
    const department = (body.department ?? "").trim();
    if (!title || !department || !Array.isArray(body.required_skills) || body.required_skills.length === 0) {
      return json({ error: "VALIDATION_ERROR", message: "title, department and required_skills are required." }, 400);
    }
    const { data, error } = await supabase
      .from("job_requisitions")
      .insert({
        org_id: caller.org_id,
        title,
        department,
        seniority_level: body.seniority_level ?? 3,
        required_skills: body.required_skills,
        future_skills: body.future_skills ?? [],
        applicants: [],
        audit_events: [{ actor: caller.email ?? uid, action: "created", note: "Requisition opened.", timestamp: now }],
      })
      .select()
      .single();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    return json({ ok: true, requisition: data });
  }

  if (action === "apply") {
    const reqId = (body.req_id ?? "").trim();
    const twinId = (body.twin_id ?? "").trim();
    if (!reqId || !twinId) return json({ error: "VALIDATION_ERROR", message: "req_id and twin_id are required." }, 400);

    const [reqRes, twinRes] = await Promise.all([
      supabase.from("job_requisitions").select("id, org_id, applicants, audit_events").eq("id", reqId).maybeSingle(),
      supabase.from("digital_twins").select("id, org_id, role").eq("id", twinId).maybeSingle(),
    ]);
    if (!reqRes.data || !twinRes.data) return json({ error: "NOT_FOUND" }, 404);
    if (reqRes.data.org_id !== caller.org_id || twinRes.data.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

    const applicants = (reqRes.data.applicants ?? []) as { twin_id: string; stage: string; application_code: string }[];
    if (applicants.some((a) => a.twin_id === twinId)) {
      return json({ ok: true, already_applied: true, applicant: applicants.find((a) => a.twin_id === twinId) });
    }
    const applicant = { twin_id: twinId, stage: "screening", application_code: genCode(), applied_at: now, match_score: null };
    const { error } = await supabase
      .from("job_requisitions")
      .update({
        applicants: [...applicants, applicant],
        audit_events: [...(reqRes.data.audit_events ?? []), { actor: caller.email ?? uid, action: "applicant_added", note: "Candidate applied.", timestamp: now }],
      })
      .eq("id", reqId);
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    return json({ ok: true, applicant });
  }

  if (action === "update") {
    const reqId = (body.req_id ?? "").trim();
    if (!reqId) return json({ error: "VALIDATION_ERROR", message: "req_id is required." }, 400);

    const { data: existing, error: getErr } = await supabase
      .from("job_requisitions")
      .select("id, org_id, title, department, seniority_level, required_skills, future_skills, audit_events")
      .eq("id", reqId)
      .maybeSingle();
    if (getErr || !existing) return json({ error: "NOT_FOUND" }, 404);
    if (existing.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

    const patch: Record<string, unknown> = {};
    const audit: unknown[] = [...(existing.audit_events ?? [])];

    if (body.title !== undefined) patch.title = body.title;
    if (body.department !== undefined) patch.department = body.department;
    if (body.seniority_level !== undefined) patch.seniority_level = body.seniority_level;
    if (body.future_skills !== undefined) patch.future_skills = body.future_skills;

    // Changing required_skills must stale every existing match score for this
    // requisition — the audit event timestamp makes skill-match recompute.
    if (body.required_skills !== undefined && !skillsEqual(existing.required_skills, body.required_skills)) {
      patch.required_skills = body.required_skills;
      audit.push({
        actor: caller.email ?? uid,
        action: "requirements_changed",
        note: "Required skills changed — existing match scores are now stale until recalculated.",
        timestamp: now,
      });
    }
    if (Object.keys(patch).length === 0) return json({ ok: true, requisition: existing, unchanged: true });
    patch.audit_events = audit;

    const { data, error } = await supabase.from("job_requisitions").update(patch).eq("id", reqId).select().single();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    return json({ ok: true, requisition: data });
  }

  return json({ error: "VALIDATION_ERROR", message: "action must be create, update or apply." }, 400);
});
