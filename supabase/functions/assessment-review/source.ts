import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeFit } from "../_shared/skill-graph-engine.ts";
import { loadAssertions, resolveSkillClaims, resolveSkillId } from "../_shared/evidence.ts";
import {
  answerFor,
  isJudgmentValue,
  normalizeJudgment,
  quoteExists,
  type JudgmentItem,
} from "../_shared/assessment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ROLE_GATE = ["hr_executive", "recruiter"];
const TIER_FOR_PROF = { 3: "INTERMEDIATE", 4: "ADVANCED", 5: "EXPERT" } as const;

interface ReviewJudgmentInput {
  competency: string;
  judgment: string;
  evidence_quotes?: string[];
  reason?: string;
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
    .select("id, role, email, org_id, audit_events")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !ROLE_GATE.includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
  }

  let body: {
    assessment_id?: string;
    determination?: string;
    judgments?: ReviewJudgmentInput[];
    reason?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const assessmentId = (body.assessment_id ?? "").trim();
  const determination = body.determination ?? "";
  if (!assessmentId || !["confirm", "override"].includes(determination)) {
    return json({ error: "VALIDATION_ERROR", message: "assessment_id and determination (confirm|override) are required." }, 400);
  }

  const { data: assessment } = await supabase
    .from("assessments")
    .select("*")
    .eq("id", assessmentId)
    .eq("org_id", caller.org_id)
    .maybeSingle();
  if (!assessment) return json({ error: "NOT_FOUND" }, 404);
  const result = (assessment.result ?? {}) as {
    session_id?: string;
    session_type?: string;
    blueprint_id?: string;
    competency?: string;
    ai?: { judgments?: JudgmentItem[]; summary?: string; evaluator?: string };
    reviewed?: unknown;
  };
  if (!result.ai?.judgments) {
    return json({ error: "CONFLICT", message: "This assessment has no AI judgment to review yet." }, 409);
  }

  const { data: session } = await supabase
    .from("candidate_sessions")
    .select("*")
    .eq("id", result.session_id ?? "__none__")
    .eq("org_id", caller.org_id)
    .maybeSingle();
  if (!session) return json({ error: "NOT_FOUND", message: "Session missing for this assessment." }, 404);
  const answers = (session.answers ?? {}) as Record<string, unknown>;

  const { data: blueprint } = await supabase
    .from("assessment_blueprints")
    .select("*")
    .eq("id", result.blueprint_id ?? "__none__")
    .eq("org_id", caller.org_id)
    .maybeSingle();
  const questions = ((blueprint?.artifact_spec as { questions?: { key: string; prompt: string }[] })?.questions ?? []);

  const { data: rubricRows } = await supabase
    .from("assessment_rubrics")
    .select("*")
    .eq("org_id", caller.org_id)
    .eq("blueprint_id", result.blueprint_id ?? "__none__")
    .order("created_at");
  const rubrics = (rubricRows ?? []) as {
    id: string;
    competency: string;
    anchors: Record<string, string>;
    skill_mapping: { skill: string; anchor_to_proficiency: Record<string, number> };
  }[];

  // --- Validate the reviewer's determination against the rubric + answers ----
  const inputByComp = new Map((body.judgments ?? []).map((j) => [j.competency.trim().toLowerCase(), j]));
  const reviewedJudgments: (JudgmentItem & { reason?: string })[] = [];
  const validationErrors: string[] = [];

  for (let i = 0; i < rubrics.length; i++) {
    const rubric = rubrics[i];
    const input = inputByComp.get(rubric.competency.toLowerCase());
    if (!input) {
      validationErrors.push(`No review judgment provided for competency "${rubric.competency}".`);
      continue;
    }
    const judgment = normalizeJudgment(input.judgment);
    if (judgment === "NOT_ASSESSED" || judgment === "INSUFFICIENT_EVIDENCE") {
      reviewedJudgments.push({
        competency: rubric.competency,
        judgment,
        evidence_quotes: [],
        anchor_ref: "",
        uncertainty: 0,
        suggested_follow_up: "",
        reason: input.reason,
      });
      continue;
    }
    if (!rubric.anchors[judgment]) validationErrors.push(`Anchor level ${judgment} is not defined for "${rubric.competency}".`);
    const quotes = (input.evidence_quotes ?? []).filter(Boolean);
    if (quotes.length === 0) {
      validationErrors.push(`Provide at least one quoted passage from the candidate's answer for "${rubric.competency}".`);
    } else {
      const question = questions[i];
      const blob = question ? answerFor(answers, question.key) : "";
      for (const q of quotes) {
        if (!quoteExists(q, blob)) validationErrors.push(`Quote not found in the answer for "${rubric.competency}": "${q.slice(0, 80)}"`);
      }
    }
    if (determination === "override" && !(input.reason ?? "").trim() && !(body.reason ?? "").trim()) {
      validationErrors.push(`An override needs a reason for "${rubric.competency}".`);
    }
    reviewedJudgments.push({
      competency: rubric.competency,
      judgment,
      evidence_quotes: quotes.slice(0, 4),
      anchor_ref: judgment,
      uncertainty: 0,
      suggested_follow_up: "",
      reason: input.reason,
    });
  }

  // Competencies outside the rubric are rejected outright (no free-form scores).
  for (const key of inputByComp.keys()) {
    if (!rubrics.some((r) => r.competency.toLowerCase() === key)) {
      validationErrors.push(`Competency "${key}" is not part of this blueprint's rubric.`);
    }
  }

  if (validationErrors.length > 0) {
    return json({ error: "VALIDATION_ERROR", message: validationErrors.slice(0, 5).join(" "), details: validationErrors }, 400);
  }

  // --- Persist the human determination (preserving the AI suggestion) --------
  const now = new Date().toISOString();
  const reviewed = {
    determination,
    judgments: reviewedJudgments,
    reason: (body.reason ?? "").trim(),
    by: caller.email ?? uid,
    by_twin_id: caller.id,
    at: now,
  };
  const { error: updErr } = await supabase
    .from("assessments")
    .update({
      result: { ...result, reviewed },
      reviewed_by: caller.id,
      reviewed_at: now,
    })
    .eq("id", assessment.id);
  if (updErr) return json({ error: "INTERNAL", message: updErr.message }, 500);

  // --- Write supported evidence + skill assertions (fit provenance) ----------
  const written: { competency: string; skill: string; assertion_id: string; evidence_id: string; proficiency: number }[] = [];
  const sourceType = result.session_type === "work_sample" ? "work_sample" : "interview";
  for (let i = 0; i < reviewedJudgments.length; i++) {
    const item = reviewedJudgments[i];
    const rubric = rubrics[i];
    const mapping = rubric?.skill_mapping;
    const proficiency = mapping?.anchor_to_proficiency?.[item.judgment];
    if (!rubric || !mapping?.skill || !proficiency || !isJudgmentValue(item.judgment)) continue;

    const { data: evidenceRow, error: evErr } = await supabase
      .from("evidence_items")
      .insert({
        org_id: caller.org_id,
        twin_id: session.twin_id,
        source_type: sourceType,
        source_id: `assessment:${assessment.id}:${rubric.competency}`,
        source_version: `v${blueprint?.version ?? 1}`,
        captured_at: now,
        quote: item.evidence_quotes?.[0] ?? item.competency,
        review_state: "assessment_supported",
        reviewed_by: caller.id,
        reviewed_at: now,
        metadata: {
          session_id: session.id,
          assessment_id: assessment.id,
          competency: rubric.competency,
          anchor: item.judgment,
          skill: mapping.skill,
        },
      })
      .select("id")
      .single();
    if (evErr) continue;

    const skillId = await resolveSkillId(supabase, caller.org_id, mapping.skill).catch(() => null);
    if (!skillId) continue;

    // Unique (org, twin, skill, state, proficiency) — skip an exact duplicate.
    const { data: existing } = await supabase
      .from("skill_assertions")
      .select("id")
      .eq("org_id", caller.org_id)
      .eq("twin_id", session.twin_id)
      .eq("skill_id", skillId)
      .eq("review_state", "assessment_supported")
      .eq("claimed_proficiency", proficiency)
      .maybeSingle();

    if (existing) {
      const { data: existingRow } = await supabase
        .from("skill_assertions")
        .select("evidence_ids")
        .eq("id", existing.id)
        .single();
      const ids = [...new Set([...(existingRow?.evidence_ids ?? []), evidenceRow.id])];
      await supabase.from("skill_assertions").update({ evidence_ids: ids }).eq("id", existing.id);
      written.push({ competency: rubric.competency, skill: mapping.skill, assertion_id: existing.id, evidence_id: evidenceRow.id, proficiency });
      continue;
    }

    const { data: assertionRow, error: asErr } = await supabase
      .from("skill_assertions")
      .insert({
        org_id: caller.org_id,
        twin_id: session.twin_id,
        skill_id: skillId,
        claimed_proficiency: proficiency,
        proficiency_tier: TIER_FOR_PROF[proficiency as 3 | 4 | 5] ?? "INTERMEDIATE",
        review_state: "assessment_supported",
        evidence_ids: [evidenceRow.id],
      })
      .select("id")
      .single();
    if (!asErr && assertionRow) {
      written.push({ competency: rubric.competency, skill: mapping.skill, assertion_id: assertionRow.id, evidence_id: evidenceRow.id, proficiency });
    }
  }

  // --- Recompute the candidate's fit (assertions-first; provenance preserved) --
  const { data: application } = await supabase
    .from("applications")
    .select("*")
    .eq("id", session.application_id)
    .eq("org_id", caller.org_id)
    .maybeSingle();
  let fit: { current: number | null; future: number | null } = { current: null, future: null };
  if (application) {
    const { data: reqRow } = await supabase
      .from("job_requisitions")
      .select("id, org_id, title, required_skills, future_skills, seniority_level")
      .eq("id", application.requisition_id)
      .eq("org_id", caller.org_id)
      .maybeSingle();
    const { data: twin } = await supabase
      .from("digital_twins")
      .select("id, org_id, seniority_level, computed_fits, audit_events")
      .eq("id", session.twin_id)
      .maybeSingle();
    if (reqRow && twin) {
      const { data: graphRows } = await supabase
        .from("skill_graph")
        .select("skill, category, outgoing_edges")
        .eq("org_id", caller.org_id);
      const claims = await resolveSkillClaims(supabase, twin);
      const fitCurrent = computeFit({
        candidateSkills: claims,
        candidateLevel: twin.seniority_level ?? 3,
        requiredSkills: reqRow.required_skills ?? [],
        roleLevel: reqRow.seniority_level ?? 3,
        skillGraph: graphRows ?? [],
        target: { type: "requisition", id: reqRow.id, title: reqRow.title },
        scenario: "current",
        computedAt: now,
      });
      const fitFuture = computeFit({
        candidateSkills: claims,
        candidateLevel: twin.seniority_level ?? 3,
        requiredSkills: reqRow.future_skills ?? [],
        roleLevel: reqRow.seniority_level ?? 3,
        skillGraph: graphRows ?? [],
        target: { type: "requisition", id: reqRow.id, title: reqRow.title },
        scenario: "future",
        computedAt: now,
      });
      const fits = (twin.computed_fits ?? []) as { target_id: string; scenario: string }[];
      const nextFits = fits
        .filter((f) => !(f.target_id === reqRow.id && (f.scenario === "current" || f.scenario === "future")))
        .concat([fitCurrent, fitFuture] as unknown as { target_id: string; scenario: string }[]);
      await supabase
        .from("digital_twins")
        .update({
          computed_fits: nextFits,
          audit_events: [
            ...(twin.audit_events ?? []),
            {
              actor: caller.email ?? uid,
              action: "assessment_reviewed",
              note: `Assessment reviewed (${determination}); ${written.length} supported evidence record(s) written. Fit current ${fitCurrent.score.toFixed(3)} / future ${fitFuture.score.toFixed(3)}.`,
              timestamp: now,
            },
          ],
        })
        .eq("id", twin.id);
      fit = { current: fitCurrent.score, future: fitFuture.score };
    }
  }

  return json({
    ok: true,
    assessment_id: assessment.id,
    reviewed,
    evidence_written: written,
    fit,
  });
});
