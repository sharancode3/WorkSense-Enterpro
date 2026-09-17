// ---------------------------------------------------------------------------
// Per-task runtime schema + semantic validation for Qwen outputs.
// Runs AFTER generation regardless of provider structured-output support.
// No invalid/partial model output becomes trusted domain data.
// ---------------------------------------------------------------------------

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const TIERS = ["FOUNDATIONAL", "INTERMEDIATE", "ADVANCED", "EXPERT"];
const EVAL_TIERS = ["Red Flag", "Developing", "Competent-Baseline", "Advanced", "Master-Architectural"];
const EVAL_RECS = ["Select", "Move Forward", "Reject"];
const POLICY_STATUS = ["grounded_response", "insufficient_evidence"];
const TREND = ["up", "flat", "down"];
const SIGNOFF = ["HR_EXECUTIVE", "MANAGER"];

function fail(errors: string[]): ValidationResult {
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// 1) Resume Evidence Extraction (6.1)
export function validateResumeExtraction(d: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ["response is not an object"] };
  if (!isStr(d.full_name) || d.full_name.trim().length === 0) errors.push("full_name must be a non-empty string");
  if (!isNum(d.years_experience) || d.years_experience < 0 || d.years_experience > 60) errors.push("years_experience must be 0..60");
  const skills = d.extracted_skills;
  if (!isArr(skills)) errors.push("extracted_skills must be an array");
  else {
    for (const raw of skills) {
      const s = isObj(raw) ? raw : null;
      if (!s || !isStr(s.skill_name) || s.skill_name.trim().length === 0 || s.skill_name.length > 80) errors.push("skill_name missing/too long");
      if (!s || !isNum(s.years) || s.years < 0 || s.years > 50) errors.push("skill years out of bounds");
      if (!s || !isStr(s.proficiency_tier) || !TIERS.includes(s.proficiency_tier)) errors.push(`proficiency_tier must be one of ${TIERS.join(",")}`);
      if (!s || !isStr(s.evidence_quote) || s.evidence_quote.length > 200) errors.push("evidence_quote must be a short string");
    }
  }
  if (!isArr(d.verified_projects)) errors.push("verified_projects must be an array");
  return fail(errors);
}

// 2) 5-Tier Interview Rubric (6.2)
export function validateRubric(d: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ["response is not an object"] };
  if (!isStr(d.competency) || d.competency.trim().length === 0) errors.push("competency missing");
  if (!isStr(d.question) || d.question.trim().length === 0) errors.push("question missing");
  if (!isArr(d.follow_up_probes) || d.follow_up_probes.length !== 2 || d.follow_up_probes.some((p) => !isStr(p) || p.length === 0)) {
    errors.push("follow_up_probes must contain exactly 2 non-empty strings");
  }
  if (!isObj(d.rubric)) errors.push("rubric must be an object");
  else {
    for (let i = 1; i <= 5; i++) {
      const k = `tier_${i}` as const;
      if (!isStr(d.rubric[k]) || (d.rubric[k] as string).trim().length === 0) errors.push(`rubric.${k} must be a non-empty string`);
    }
  }
  return fail(errors);
}

// 3) Assessment Evaluation
export function validateEvaluation(d: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ["response is not an object"] };
  if (!isArr(d.evaluations)) errors.push("evaluations must be an array");
  else {
    for (const raw of d.evaluations) {
      const e = isObj(raw) ? raw : null;
      if (!e) { errors.push("evaluation item not an object"); continue; }
      if (!isStr(e.competency) || e.competency.trim().length === 0) errors.push("evaluation competency missing");
      if (!isStr(e.tier) || !EVAL_TIERS.includes(e.tier)) errors.push(`tier must be one of ${EVAL_TIERS.join("|")}`);
      if (!isNum(e.score) || e.score < 1 || e.score > 5 || !Number.isInteger(e.score)) errors.push("score must be an integer 1..5");
      if (!isStr(e.evidence) || e.evidence.trim().length === 0) errors.push("evidence missing (assessment must be evidence-linked)");
    }
  }
  if (!isStr(d.overall_recommendation) || !EVAL_RECS.includes(d.overall_recommendation)) errors.push(`overall_recommendation must be one of ${EVAL_RECS.join("|")}`);
  return fail(errors);
}

// 4) Grounded Policy Answer (6.3)
export function validatePolicyAnswer(d: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ["response is not an object"] };
  if (!isStr(d.status) || !POLICY_STATUS.includes(d.status)) errors.push(`status must be one of ${POLICY_STATUS.join("|")}`);
  if (!isStr(d.answer)) errors.push("answer must be a string");
  if (!isArr(d.citations)) errors.push("citations must be an array");
  else {
    for (const raw of d.citations) {
      const c = isObj(raw) ? raw : null;
      if (!c) { errors.push("citation not an object"); continue; }
      if (!isStr(c.doc_code) || !/^POL-/.test(c.doc_code)) errors.push("citation doc_code must start with POL-");
      if (!isStr(c.section) || c.section.trim().length === 0) errors.push("citation section missing");
      if (!isStr(c.exact_quote) || c.exact_quote.trim().length === 0) errors.push("citation exact_quote missing");
    }
  }
  return fail(errors);
}

// 5) Performance Narrative
export function validatePerformanceNarrative(d: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ["response is not an object"] };
  if (!isStr(d.strengths) || d.strengths.trim().length === 0) errors.push("strengths missing");
  if (!isStr(d.growth_areas) || d.growth_areas.trim().length === 0) errors.push("growth_areas missing");
  if (!isStr(d.trend_direction) || !TREND.includes(d.trend_direction)) errors.push(`trend_direction must be one of ${TREND.join("|")}`);
  if (!isNum(d.confidence) || d.confidence < 0 || d.confidence > 1) errors.push("confidence must be 0..1");
  return fail(errors);
}

// 6) Recommendation Explanation (6.4)
export function validateRecommendationExplanation(d: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ["response is not an object"] };
  if (!isStr(d.title) || d.title.trim().length === 0) errors.push("title missing");
  if (!isStr(d.executive_summary) || d.executive_summary.trim().length < 20) errors.push("executive_summary too short");
  if (!isObj(d.proposed_action) || !isStr(d.proposed_action.action_type) || !isStr(d.proposed_action.target_entity_id)) {
    errors.push("proposed_action.action_type/target_entity_id required");
  }
  if (!isStr(d.required_human_signoff_role) || !SIGNOFF.includes(d.required_human_signoff_role)) {
    errors.push(`required_human_signoff_role must be one of ${SIGNOFF.join("|")}`);
  }
  return fail(errors);
}
