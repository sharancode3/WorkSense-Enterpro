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

// ---------------------------------------------------------------------------
// Requisition criteria — the weighted selection contract behind the Compare
// workspace. Additive JSONB: required_skills/future_skills remain readable and
// required_skills is kept in sync (derived from criteria marked "required").
// ---------------------------------------------------------------------------
export interface ReqCriterion {
  skill: string;
  target_proficiency: number; // 1..5
  requirement: "required" | "preferred";
  weight: number; // 0..1
  evidence_expectation: string;
}

const REQUIREMENTS = new Set(["required", "preferred"]);

function normalizeCriteria(raw: unknown): { ok: true; criteria: ReqCriterion[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, message: "At least one criterion is required." };
  const criteria: ReqCriterion[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const skill = String(item?.skill ?? "").trim();
    const proficiency = Number(item?.target_proficiency ?? 3);
    const requirement = String(item?.requirement ?? "required") as ReqCriterion["requirement"];
    const weight = Number(item?.weight);
    const evidence = String(item?.evidence_expectation ?? "").trim();
    if (!skill) return { ok: false, message: "Every criterion needs a skill name." };
    if (!Number.isInteger(proficiency) || proficiency < 1 || proficiency > 5) {
      return { ok: false, message: `"${skill}" proficiency must be an integer between 1 and 5.` };
    }
    if (!REQUIREMENTS.has(requirement)) return { ok: false, message: `"${skill}" requirement must be required or preferred.` };
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      return { ok: false, message: `"${skill}" weight must be between 0 and 1.` };
    }
    if (!evidence) return { ok: false, message: `"${skill}" needs an evidence expectation.` };
    criteria.push({ skill, target_proficiency: proficiency, requirement, weight, evidence_expectation: evidence });
  }
  // Keep required skills first, stable order.
  criteria.sort((a, b) => Number(b.requirement === "required") - Number(a.requirement === "required"));
  return { ok: true, criteria };
}

/** required_skills derived from criteria (backwards-compatible view). */
function criteriaToRequired(criteria: ReqCriterion[]) {
  return criteria.filter((c) => c.requirement === "required").map((c) => ({ skill: c.skill, target_proficiency: c.target_proficiency }));
}

/** preferred criteria kept as future_skills for the skill graph's future scenario. */
function criteriaToFuture(criteria: ReqCriterion[]) {
  return criteria.filter((c) => c.requirement === "preferred").map((c) => ({ skill: c.skill, target_proficiency: c.target_proficiency }));
}

function skillsEqual(a: { skill: string; target_proficiency?: number }[] | undefined, b: { skill: string; target_proficiency?: number }[] | undefined): boolean {
  const norm = (arr?: { skill: string; target_proficiency?: number }[]) =>
    (arr ?? []).map((s) => `${s.skill.toLowerCase()}:${s.target_proficiency ?? 0}`).sort().join(",");
  return norm(a) === norm(b);
}

function criteriaEqual(a: ReqCriterion[], b: ReqCriterion[]): boolean {
  const norm = (arr: ReqCriterion[]) =>
    arr.map((c) => `${c.skill.toLowerCase()}|${c.target_proficiency}|${c.requirement}|${c.weight}|${c.evidence_expectation}`).sort().join(",");
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

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const action = String(body.action ?? "");
  const now = new Date().toISOString();

  if (action === "create") {
    const title = String(body.title ?? "").trim();
    const department = String(body.department ?? "").trim();
    const seniority = Number(body.seniority_level ?? 3);
    const rawCriteria = body.criteria ?? null;

    // Criteria-driven creation is the Phase 4 path; the legacy required_skills
    // shape is still accepted so old callers keep working.
    let criteria: ReqCriterion[] | null = null;
    if (rawCriteria !== null) {
      const norm = normalizeCriteria(rawCriteria);
      if (norm.ok === false) return json({ error: "VALIDATION_ERROR", message: norm.message }, 400);
      criteria = norm.criteria;
    } else if (!Array.isArray(body.required_skills) || (body.required_skills as unknown[]).length === 0) {
      return json({ error: "VALIDATION_ERROR", message: "criteria (or required_skills) is required." }, 400);
    }

    const { data, error } = await supabase
      .from("job_requisitions")
      .insert({
        org_id: caller.org_id,
        title,
        department,
        seniority_level: seniority,
        required_skills: criteria ? criteriaToRequired(criteria) : body.required_skills,
        future_skills: criteria ? criteriaToFuture(criteria) : (body.future_skills ?? []),
        requisition_criteria: criteria ?? [],
        applicants: [],
        audit_events: [{ actor: caller.email ?? uid, action: "created", note: "Requisition opened.", timestamp: now }],
      })
      .select()
      .single();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    return json({ ok: true, requisition: data });
  }

  if (action === "apply") {
    const reqId = String(body.req_id ?? "").trim();
    const twinId = String(body.twin_id ?? "").trim();
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
    const reqId = String(body.req_id ?? "").trim();
    if (!reqId) return json({ error: "VALIDATION_ERROR", message: "req_id is required." }, 400);

    const { data: existing, error: getErr } = await supabase
      .from("job_requisitions")
      .select("id, org_id, title, department, seniority_level, required_skills, future_skills, requisition_criteria, audit_events")
      .eq("id", reqId)
      .maybeSingle();
    if (getErr || !existing) return json({ error: "NOT_FOUND" }, 404);
    if (existing.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

    const patch: Record<string, unknown> = {};
    const audit: unknown[] = [...(existing.audit_events ?? [])];
    const existingCriteria = (existing.requisition_criteria ?? []) as ReqCriterion[];

    if (body.title !== undefined) patch.title = String(body.title);
    if (body.department !== undefined) patch.department = String(body.department);
    if (body.seniority_level !== undefined) patch.seniority_level = Number(body.seniority_level);

    // Criteria changes restate the whole weighted contract and always stale
    // every existing match score (audit timestamp drives the compare buckets).
    if (body.criteria !== undefined) {
      const norm = normalizeCriteria(body.criteria);
      if (norm.ok === false) return json({ error: "VALIDATION_ERROR", message: norm.message }, 400);
      if (!criteriaEqual(existingCriteria, norm.criteria)) {
        patch.requisition_criteria = norm.criteria;
        patch.required_skills = criteriaToRequired(norm.criteria);
        patch.future_skills = criteriaToFuture(norm.criteria);
        audit.push({
          actor: caller.email ?? uid,
          action: "requirements_changed",
          note: "Selection criteria changed — existing match scores are stale until recalculated.",
          timestamp: now,
        });
      }
    }

    if (Object.keys(patch).length === 0) return json({ ok: true, requisition: existing, unchanged: true });
    patch.audit_events = audit;

    const { data, error } = await supabase.from("job_requisitions").update(patch).eq("id", reqId).select().single();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    return json({ ok: true, requisition: data });
  }

  return json({ error: "VALIDATION_ERROR", message: "action must be create, update or apply." }, 400);
});
