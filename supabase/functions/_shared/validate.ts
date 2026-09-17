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

// 8) Assessment Evaluation (Phase 6) — per-competency judgment block emitted by
// the model. Semantic checks (quotes exist, score bounds vs rubric anchors) run
// in assessment.ts validateJudgmentItem, which has the rubric + answers context.
const ASSESSMENT_JUDGMENTS = ["1", "2", "3", "4", "5", "NOT_ASSESSED", "INSUFFICIENT_EVIDENCE"];

export function validateAssessmentJudgment(d: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ["response is not an object"] };
  if (!isArr(d.judgments)) errors.push("judgments must be an array");
  else {
    for (const raw of d.judgments) {
      const j = isObj(raw) ? raw : null;
      if (!j) { errors.push("judgment item not an object"); continue; }
      if (!isStr(j.competency) || j.competency.trim().length === 0) errors.push("judgment competency missing");
      if (!isStr(j.judgment) || !ASSESSMENT_JUDGMENTS.includes(j.judgment)) {
        errors.push(`judgment must be one of ${ASSESSMENT_JUDGMENTS.join("|")}`);
      }
      if (!isArr(j.evidence_quotes)) errors.push("judgment evidence_quotes must be an array");
      else if (j.evidence_quotes.some((q) => !isStr(q))) errors.push("evidence_quotes entries must be strings");
      if (j.anchor_ref !== undefined && j.anchor_ref !== null && !isStr(j.anchor_ref)) errors.push("anchor_ref must be a string");
      if (j.uncertainty !== undefined && (!isNum(j.uncertainty) || j.uncertainty < 0 || j.uncertainty > 1)) {
        errors.push("uncertainty must be a number 0..1");
      }
      if (j.suggested_follow_up !== undefined && j.suggested_follow_up !== null && !isStr(j.suggested_follow_up)) {
        errors.push("suggested_follow_up must be a string");
      }
    }
  }
  if (!isStr(d.summary) || d.summary.trim().length === 0) errors.push("summary missing");
  return fail(errors);
}

// 7) Rich Resume Review (Phase 4) — the full traceable extraction schema.
export function validateResumeReview(d: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ["response is not an object"] };
  if (!isStr(d.full_name) || d.full_name.trim().length === 0) errors.push("full_name must be a non-empty string");

  const contact = d.contact;
  if (contact !== undefined && contact !== null && !isObj(contact)) errors.push("contact must be an object");
  else if (isObj(contact)) {
    for (const k of ["email", "phone", "location", "linkedin"]) {
      if (contact[k] !== undefined && contact[k] !== null && !isStr(contact[k])) errors.push(`contact.${k} must be a string`);
      if (isStr(contact[k]) && (contact[k] as string).length > 200) errors.push(`contact.${k} too long`);
    }
  }

  const checkRoles = (arr: unknown, label: string) => {
    if (!isArr(arr)) {
      errors.push(`${label} must be an array`);
      return;
    }
    for (const raw of arr) {
      const r = isObj(raw) ? raw : null;
      if (!r) {
        errors.push(`${label}: entry must be an object`);
        return;
      }
      if (!isStr(r.title) || r.title.trim().length === 0) errors.push(`${label}: title missing`);
      if (!isStr(r.company)) errors.push(`${label}: company must be a string`);
      if (r.start !== undefined && !isStr(r.start)) errors.push(`${label}: start must be a string`);
      if (r.end !== undefined && !isStr(r.end)) errors.push(`${label}: end must be a string`);
      if (r.years_claimed !== undefined && (!isNum(r.years_claimed) || r.years_claimed < 0 || r.years_claimed > 60)) errors.push(`${label}: years_claimed must be 0..60`);
      if (!isStr(r.quote) || r.quote.trim().length === 0 || r.quote.length > 300) errors.push(`${label}: quote must be a short string`);
    }
  };
  checkRoles(d.roles, "roles");

  const checkSimple = (arr: unknown, label: string, quoteRequired: boolean) => {
    if (!isArr(arr)) {
      errors.push(`${label} must be an array`);
      return;
    }
    for (const raw of arr) {
      const r = isObj(raw) ? raw : null;
      if (!r) {
        errors.push(`${label}: entry must be an object`);
        return;
      }
      const names = label === "education" ? ["institution", "degree", "year"] : label === "certifications" ? ["name", "issuer", "year"] : ["name", "role"];
      for (const k of names) if (!isStr(r[k])) errors.push(`${label}: ${k} must be a string`);
      if (label === "projects") {
        if (!isArr(r.tech_stack)) errors.push(`${label}: tech_stack must be an array`);
        if (r.impact_metric !== undefined && !isStr(r.impact_metric)) errors.push(`${label}: impact_metric must be a string`);
      }
      if (quoteRequired && (!isStr(r.quote) || r.quote.trim().length === 0 || r.quote.length > 300)) errors.push(`${label}: quote must be a short string`);
    }
  };
  checkSimple(d.education, "education", true);
  checkSimple(d.certifications, "certifications", true);
  checkSimple(d.projects, "projects", true);

  const claims = d.skill_claims;
  if (!isArr(claims)) errors.push("skill_claims must be an array");
  else {
    for (const raw of claims) {
      const c = isObj(raw) ? raw : null;
      if (!c) {
        errors.push("skill_claims: entry must be an object");
        return;
      }
      if (!isStr(c.skill) || c.skill.trim().length === 0 || c.skill.length > 80) errors.push("skill_claims: skill missing/too long");
      if (c.years !== undefined && (!isNum(c.years) || c.years < 0 || c.years > 50)) errors.push("skill_claims: years out of bounds");
      if (!isStr(c.proficiency_tier) || !TIERS.includes(c.proficiency_tier)) errors.push(`skill_claims: proficiency_tier must be one of ${TIERS.join(",")}`);
      if (!isStr(c.quote) || c.quote.trim().length === 0 || c.quote.length > 300) errors.push("skill_claims: quote must be a short string");
      if (!isStr(c.association) || !["explicit", "inferred", "unsupported"].includes(c.association)) {
        errors.push("skill_claims: association must be explicit|inferred|unsupported");
      }
    }
  }
  if (!isArr(d.ambiguities)) errors.push("ambiguities must be an array");
  if (!isArr(d.conflicts)) errors.push("conflicts must be an array");
  return fail(errors);
}
