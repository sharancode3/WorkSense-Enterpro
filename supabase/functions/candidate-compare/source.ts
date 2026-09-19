import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  buildCandidateComparison,
  type CandidateSignals,
  type CompareInputs,
  type CompareRow,
  type ReqCriterionView,
} from "../_shared/candidate-compare.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Normalize rubric judgments (strings or numbers) to a 0-1 mean. Deterministic;
 *  words are ranked by their order in the rubric. Null when no usable judgments. */
function rubricScore(judgments: { judgment?: unknown }[] | undefined | null): number | null {
  const vals = (judgments ?? []).map((j) => j?.judgment).filter((v) => v !== undefined && v !== null);
  if (vals.length === 0) return null;
  const numeric = vals.map((v) => Number(v));
  if (numeric.every((n) => Number.isFinite(n))) {
    const max = Math.max(...numeric, 1);
    return Math.max(0, Math.min(1, numeric.reduce((a, b) => a + b, 0) / numeric.length / max));
  }
  const unique = [...new Set(vals.map((v) => String(v).trim().toLowerCase()))].sort();
  const mean = vals.reduce<number>((s, v) => s + (unique.indexOf(String(v).trim().toLowerCase()) + 1) / unique.length, 0) / vals.length;
  return Math.max(0, Math.min(1, mean));
}

function signalsFor(
  assessments: { twin_id: string; type: string; result?: unknown; reviewed_at?: string | null }[],
  sessions: { twin_id?: string | null; session_type?: string; submitted_at?: string | null }[],
  interviewRubrics: { twin_id: string; rubrics: { role?: string; round?: string; avg_score?: number | null; evaluated_at?: string | null }[] }[]
): Map<string, CandidateSignals> {
  const out = new Map<string, CandidateSignals>();
  const byTwin = new Map<string, CandidateSignals>();

  const merged = (twinId: string) => {
    let s = byTwin.get(twinId);
    if (!s) {
      s = {
        work_sample: null,
        work_sample_reviewed: false,
        knowledge: null,
        knowledge_reviewed: false,
        interview_score: null,
        interview_status: "none",
        assessment_submitted: false,
      };
      byTwin.set(twinId, s);
    }
    return s;
  };

  for (const a of assessments) {
    const s = merged(a.twin_id);
    const result = (a.result ?? {}) as { session_type?: string; ai?: { judgments?: unknown[] }; reviewed?: { judgments?: unknown[] } };
    const judgments = (result.reviewed?.judgments?.length ? result.reviewed.judgments : result.ai?.judgments) as
      | { judgment?: unknown }[]
      | undefined;
    const score = rubricScore(judgments);
    const reviewed = Boolean(a.reviewed_at);
    if (a.type === "work_sample" || result.session_type === "work_sample") {
      s.work_sample = score;
      s.work_sample_reviewed = s.work_sample_reviewed || reviewed;
    } else if (a.type === "knowledge_assessment" || result.session_type === "knowledge_assessment") {
      s.knowledge = score;
      s.knowledge_reviewed = s.knowledge_reviewed || reviewed;
    } else {
      // structured interview assessment
      s.interview_score = score ?? s.interview_score;
      if (score !== null) s.interview_status = "scored";
    }
  }

  for (const sess of sessions) {
    if (!sess.twin_id) continue;
    const s = merged(sess.twin_id);
    if (sess.submitted_at) s.assessment_submitted = true;
  }

  // Interview rubric scores from the twin record (latest round first).
  for (const entry of interviewRubrics) {
    const rubrics = [...(entry.rubrics ?? [])].sort((a, b) => String(b.evaluated_at ?? "").localeCompare(String(a.evaluated_at ?? "")));
    const latest = rubrics[0];
    if (latest && typeof latest.avg_score === "number") {
      const s = merged(entry.twin_id);
      s.interview_score = Math.max(0, Math.min(1, latest.avg_score));
      s.interview_status = "scored";
    }
  }
  for (const [, s] of byTwin) {
    if (s.interview_score === null && s.assessment_submitted) s.interview_status = "scheduled";
  }
  return byTwin;
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
    .select("id, org_id, title, required_skills, future_skills, requisition_criteria, audit_events, applicants")
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
        .select("id, candidate_twin_id, stage, application_code, applied_at, version")
        .eq("requisition_id", reqId)
    : { data: [] as never[] };
  const apps = (appRows.data ?? []) as { id: string; candidate_twin_id: string; stage: string; application_code: string; applied_at: string; version: number }[];
  const appByTwin = new Map(apps.map((a) => [a.candidate_twin_id, a]));

  const twinIds = applicants.map((a) => a.twin_id);
  const { data: twinRows } = twinIds.length > 0
    ? await supabase.from("digital_twins").select("id, name, email, computed_fits, interview_rubrics").in("id", twinIds)
    : { data: [] as never[] };

  // Durable fits first (skill_fits), then legacy computed_fits fallback.
  const { data: storedFits } = twinIds.length > 0
    ? await supabase
        .from("skill_fits")
        .select("twin_id, fit")
        .eq("org_id", caller.org_id)
        .eq("target_type", "requisition")
        .eq("target_id", reqId)
        .eq("scenario", "current")
        .in("twin_id", twinIds)
    : { data: [] as never[] };

  const fits = new Map<string, { score: number; computed_at: string }>();
  for (const s of (storedFits ?? []) as { twin_id: string; fit?: unknown }[]) {
    if (s?.fit) fits.set(s.twin_id, s.fit as { score: number; computed_at: string });
  }
  for (const t of (twinRows ?? []) as { id: string; name: string; email: string | null; computed_fits?: unknown[] }[]) {
    if (fits.has(t.id)) continue;
    const entry = (t.computed_fits ?? []).find(
      (f) =>
        (f as { target_type?: string; target_id?: string; scenario?: string }).target_type === "requisition" &&
        (f as { target_id?: string }).target_id === reqId &&
        (f as { scenario?: string }).scenario === "current"
    );
    if (entry) fits.set(t.id, entry as { score: number; computed_at: string });
  }

  const candidates = new Map(
    ((twinRows ?? []) as { id: string; name: string; email: string | null }[]).map((t) => [t.id, { id: t.id, name: t.name, email: t.email }])
  );

  // ---- Evidence-funnel signals: assessments, candidate sessions, interviews ----
  let signals = new Map<string, CandidateSignals>();
  if (twinIds.length > 0) {
    const appIds = apps.map((a) => a.id);
    const [assessRes, sessRes] = await Promise.all([
      supabase
        .from("assessments")
        .select("id, twin_id, type, result, reviewed_at")
        .eq("org_id", caller.org_id)
        .eq("requisition_id", reqId)
        .in("twin_id", twinIds),
      appIds.length > 0
        ? supabase
            .from("candidate_sessions")
            .select("id, application_id, session_type, submitted_at")
            .eq("org_id", caller.org_id)
            .in("application_id", appIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    // candidate_sessions link through application_id -> twin_id.
    const twinByApp = new Map(apps.map((a) => [a.id, a.candidate_twin_id]));
    const sessions = ((sessRes.data ?? []) as { id: string; application_id: string; session_type?: string; submitted_at?: string | null }[])
      .map((s) => ({ twin_id: twinByApp.get(s.application_id) ?? null, session_type: s.session_type, submitted_at: s.submitted_at }));
    const interviewRubrics = (twinRows ?? []).map((t) => ({
      twin_id: t.id,
      rubrics: (((t as { interview_rubrics?: unknown }).interview_rubrics ?? []) as { role?: string; round?: string; avg_score?: number | null; evaluated_at?: string | null }[]),
    }));
    signals = signalsFor(
      (assessRes.data ?? []) as { twin_id: string; type: string; result?: unknown; reviewed_at?: string | null }[],
      sessions,
      interviewRubrics
    );
  }

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

  // Audit rework: criteria are rebuilt deterministically from required_skills +
  // future_skills (the canonical source), so mandatory skills are NEVER
  // duplicated as preferred and each section normalizes to a sum of 1.
  // Preferred = FUTURE ADDITIONS only; raised targets stay visible as future
  // capability signals via future_skills, not as duplicate criteria.
  const requiredSkills = (reqRow.required_skills ?? []) as { skill: string; target_proficiency: number }[];
  const futureSkills = (reqRow.future_skills ?? []) as { skill: string; target_proficiency: number }[];
  const requiredSet = new Set(requiredSkills.map((s) => s.skill.toLowerCase()));
  const additions = futureSkills.filter((s) => !requiredSet.has(s.skill.toLowerCase()));
  const nReq = Math.max(requiredSkills.length, 1);
  const nPref = Math.max(additions.length, 1);
  const criteria: ReqCriterionView[] = [
    ...requiredSkills.map((s) => ({
      skill: s.skill,
      target_proficiency: s.target_proficiency,
      requirement: "required" as const,
      weight: Number((1 / nReq).toFixed(2)),
      evidence_expectation: `Source artifact proving ${s.skill} at proficiency ${s.target_proficiency}: prior-role project output, work sample, or verified reference.`,
    })),
    ...additions.map((s) => ({
      skill: s.skill,
      target_proficiency: s.target_proficiency,
      requirement: "preferred" as const,
      weight: Number((1 / nPref).toFixed(2)),
      evidence_expectation: `Evidence of trajectory toward ${s.skill} (learning artifact, stretch work, or certification in progress).`,
    })),
  ];

  const result = buildCandidateComparison({
    req: {
      id: reqRow.id,
      title: reqRow.title,
      audit_events: reqRow.audit_events ?? [],
      requisition_criteria: criteria,
      required_skills: requiredSkills,
    },
    applicants: enrichedApplicants,
    candidates,
    fits,
    signals,
  });

  return json({ ok: true, req_id: reqRow.id, req_title: reqRow.title, ...result });
});
