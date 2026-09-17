import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { ASSESSMENT_SEEDS } from "../_shared/assessment.ts";

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

  let body: {
    action?: string;
    requisition_id?: string;
    competency?: string;
    title?: string;
    instructions?: string;
    time_policy?: string;
    questions?: { key: string; prompt: string; hint?: string; max_chars: number }[];
    test_cases?: { name: string; expected: string }[];
    rubrics?: {
      competency: string;
      observable_behavior: string;
      evidence_requirements: string[];
      anchors: Record<string, string>;
      critical_mistakes: string[];
      insufficient_evidence_conditions: string[];
      skill_mapping: { skill: string; anchor_to_proficiency: Record<string, number> };
    }[];
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const action = body.action ?? "";

  if (action === "seed") {
    // Upsert the canonical blueprint(s) for a requisition (deterministic,
    // idempotent: replace the existing rows for that requisition).
    const reqId = (body.requisition_id ?? "").trim();
    if (!reqId) return json({ error: "VALIDATION_ERROR", message: "requisition_id is required." }, 400);
    const { data: reqRow } = await supabase
      .from("job_requisitions")
      .select("id, org_id")
      .eq("id", reqId)
      .maybeSingle();
    if (!reqRow || reqRow.org_id !== caller.org_id) return json({ error: "NOT_FOUND" }, 404);

    const seeds = ASSESSMENT_SEEDS.filter((s) => s.requisition_id === reqId);
    if (seeds.length === 0) {
      return json({ error: "VALIDATION_ERROR", message: "No canonical blueprint exists for this requisition." }, 400);
    }

    // Replace existing blueprints for this requisition with the canonical set.
    const { data: existing } = await supabase
      .from("assessment_blueprints")
      .select("id")
      .eq("org_id", caller.org_id)
      .eq("requisition_id", reqId);
    if (existing && existing.length > 0) {
      await supabase.from("assessment_blueprints").delete().in("id", existing.map((e) => e.id));
    }

    const blueprintRows = seeds.map((s) => ({
      id: s.id,
      org_id: caller.org_id,
      requisition_id: s.requisition_id,
      competency: s.competency,
      version: s.version,
      artifact_spec: {
        title: s.title,
        kind: s.kind,
        instructions: s.instructions,
        time_policy: s.time_policy,
        questions: s.questions,
      },
      test_cases: s.test_cases,
      prompt_adaptation_allowed: s.prompt_adaptation_allowed,
      created_by: caller.id,
    }));
    const { error: bpErr } = await supabase.from("assessment_blueprints").insert(blueprintRows);
    if (bpErr) return json({ error: "INTERNAL", message: bpErr.message }, 500);

    const rubricRows = seeds.flatMap((s) =>
      s.rubrics.map((r) => ({
        id: r.id,
        org_id: caller.org_id,
        blueprint_id: s.id,
        competency: r.competency,
        version: r.version,
        observable_behavior: r.observable_behavior,
        evidence_requirements: r.evidence_requirements,
        anchors: r.anchors,
        critical_mistakes: r.critical_mistakes,
        insufficient_evidence_conditions: r.insufficient_evidence_conditions,
        skill_mapping: r.skill_mapping,
      }))
    );
    const { error: rbErr } = await supabase.from("assessment_rubrics").insert(rubricRows);
    if (rbErr) return json({ error: "INTERNAL", message: rbErr.message }, 500);

    return json({ ok: true, seeded: seeds.map((s) => ({ id: s.id, competency: s.competency, rubrics: s.rubrics.length })) });
  }

  if (action === "list") {
    const reqId = (body.requisition_id ?? "").trim();
    const { data: blueprints } = await supabase
      .from("assessment_blueprints")
      .select("id, requisition_id, competency, version, artifact_spec, test_cases, prompt_adaptation_allowed, created_at")
      .eq("org_id", caller.org_id)
      .eq("requisition_id", reqId ?? "__none__")
      .order("created_at");
    const bpIds = (blueprints ?? []).map((b) => b.id);
    const { data: rubrics } = bpIds.length > 0
      ? await supabase.from("assessment_rubrics").select("*").eq("org_id", caller.org_id).in("blueprint_id", bpIds)
      : { data: [] };
    return json({ ok: true, blueprints: (blueprints ?? []).map((b) => ({ ...b, rubrics: (rubrics ?? []).filter((r) => r.blueprint_id === b.id) })) });
  }

  if (action === "create") {
    const reqId = (body.requisition_id ?? "").trim();
    const competency = (body.competency ?? "").trim();
    const title = (body.title ?? "").trim();
    if (!reqId || !competency || !title || !Array.isArray(body.questions) || body.questions.length === 0 || !Array.isArray(body.rubrics) || body.rubrics.length === 0) {
      return json({ error: "VALIDATION_ERROR", message: "requisition_id, competency, title, questions and rubrics are required." }, 400);
    }
    const { data: reqRow } = await supabase
      .from("job_requisitions")
      .select("id, org_id")
      .eq("id", reqId)
      .maybeSingle();
    if (!reqRow || reqRow.org_id !== caller.org_id) return json({ error: "NOT_FOUND" }, 404);

    const { data: maxVer } = await supabase
      .from("assessment_blueprints")
      .select("version")
      .eq("org_id", caller.org_id)
      .eq("requisition_id", reqId)
      .eq("competency", competency)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (maxVer?.version ?? 0) + 1;

    const { data: bp, error: bpErr } = await supabase
      .from("assessment_blueprints")
      .insert({
        org_id: caller.org_id,
        requisition_id: reqId,
        competency,
        version,
        artifact_spec: { title, kind: body.questions[0]?.max_chars ? "work_sample" : "work_sample", instructions: body.instructions ?? "", time_policy: body.time_policy ?? "", questions: body.questions },
        test_cases: body.test_cases ?? [],
        prompt_adaptation_allowed: true,
        created_by: caller.id,
      })
      .select("id")
      .single();
    if (bpErr) return json({ error: "INTERNAL", message: bpErr.message }, 500);

    const rubricRows = body.rubrics.map((r) => ({
      org_id: caller.org_id,
      blueprint_id: bp.id,
      competency: r.competency,
      version,
      observable_behavior: r.observable_behavior,
      evidence_requirements: r.evidence_requirements ?? [],
      anchors: r.anchors,
      critical_mistakes: r.critical_mistakes ?? [],
      insufficient_evidence_conditions: r.insufficient_evidence_conditions ?? [],
      skill_mapping: r.skill_mapping ?? {},
    }));
    const { error: rbErr } = await supabase.from("assessment_rubrics").insert(rubricRows);
    if (rbErr) return json({ error: "INTERNAL", message: rbErr.message }, 500);

    return json({ ok: true, blueprint_id: bp.id, version, rubrics: rubricRows.length });
  }

  return json({ error: "VALIDATION_ERROR", message: "action must be seed, list or create." }, 400);
});
