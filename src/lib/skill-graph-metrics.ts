// Batch E (E1/E2): pure, client-free helpers shared with the Skill Graph page
// and unit tests. Kept separate from skill-graph.ts because that module
// instantiates the Supabase client at import time (not available in node test
// environments).
import type { FitItem, FitRecord, SkillAssertion } from "./skill-graph";

/** Same weighted composite the engine uses (see skill-graph-engine MATCH_WEIGHTS). */
const PROJ_WEIGHTS = { direct: 0.5, adjacent: 0.25, evidence: 0.15, seniority: 0.1 } as const;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** E1: how the future requirement set differs from the current one. */
export function futureRequirementDiff(
  current: { skill: string; target_proficiency: number }[],
  future: { skill: string; target_proficiency: number }[]
): { added: { skill: string; target_proficiency: number }[]; raised: { skill: string; target_proficiency: number }[]; removed: { skill: string; target_proficiency: number }[] } {
  const curMap = new Map(current.map((s) => [s.skill.toLowerCase(), s]));
  const futMap = new Map(future.map((s) => [s.skill.toLowerCase(), s]));
  return {
    added: future.filter((s) => !curMap.has(s.skill.toLowerCase())),
    raised: future.filter((s) => curMap.has(s.skill.toLowerCase()) && s.target_proficiency > curMap.get(s.skill.toLowerCase())!.target_proficiency),
    removed: current.filter((s) => !futMap.has(s.skill.toLowerCase())),
  };
}

/**
 * E2: claim-inclusive match vs verified coverage over the DIRECT skills of a
 * fit. "Verified" = reviewer-confirmed or assessment-supported assertion.
 * "Unverified" = self-reported/extracted. "Missing" = no recorded assertion.
 */
export function coverageBreakdown(
  direct: FitItem[],
  assertions: SkillAssertion[]
): { directTotal: number; verified: number; unverified: number; missing: number } {
  let verified = 0;
  let unverified = 0;
  let missing = 0;
  for (const item of direct) {
    const matches = assertions.filter((a) => (a.skill_name ?? "").toLowerCase() === item.skill.toLowerCase());
    if (matches.length === 0) { missing += 1; continue; }
    if (matches.some((a) => a.review_state === "reviewer_confirmed" || a.review_state === "assessment_supported")) verified += 1;
    else unverified += 1;
  }
  return { directTotal: direct.length, verified, unverified, missing };
}

/**
 * §55: computed "projected future readiness (with planned development)".
 *
 * Two different questions, two different numbers:
 *  - The RAW future score answers "today's evidence vs tomorrow's requirement
 *    set" — a harder/different future target legitimately scores LOWER, and a
 *    person with no overlap with the role collapses to the evidence+seniority
 *    floor (so current and future look identical).
 *  - THIS helper answers "where would this person be after following the role's
 *    development plan for the 12–24 month horizon?" People learn, so it credits
 *    every future requirement with an attainment based on how much foundation
 *    already exists, then recomputes the SAME weighted composite the engine
 *    uses (50/25/15/10). Because each requirement's attainment is >= its raw
 *    contribution, the projected score is ALWAYS >= the raw future score —
 *    growth from evidence-grounded development, never a fabricated 100.
 *
 * Attainment basis (a stated assumption, not measured capability):
 *   already at/above the bar → 1.00  (holds it today)
 *   holds it below the bar   → 0.90  (small gap, closes with practice)
 *   adjacent graph edge      → 0.85  (related skill, high transfer)
 *   transferable edge        → 0.60  (weaker transfer)
 *   no recorded foundation   → 0.35  (formal training required, lowest confidence)
 */
export const DEVELOPMENT_ATTAINMENT = {
  met: 1,
  partial: 0.9,
  adjacent: 0.85,
  transferable: 0.6,
  gap: 0.35,
} as const;

export interface DevelopmentStep {
  skill: string;
  /** How the projection justifies the credit for this future requirement. */
  basis: FitItem["classification"];
  attainment: number;
}

function attainmentFor(item: FitItem): number {
  if (item.classification === "direct") {
    return (item.candidate_proficiency ?? 0) >= item.required_proficiency
      ? DEVELOPMENT_ATTAINMENT.met
      : DEVELOPMENT_ATTAINMENT.partial;
  }
  if (item.classification === "adjacent") return DEVELOPMENT_ATTAINMENT.adjacent;
  if (item.classification === "transferable") return DEVELOPMENT_ATTAINMENT.transferable;
  return DEVELOPMENT_ATTAINMENT.gap;
}

export function projectedFutureReadiness(future: FitRecord): {
  score: number;
  /** Future requirements that still need development, strongest foundation first. */
  developmentPlan: DevelopmentStep[];
  /** Future requirements already at/above the bar today. */
  alreadyMet: FitItem[];
  metSkills: number;
  total: number;
} {
  const items: FitItem[] = [
    ...(future.classification.direct ?? []),
    ...(future.classification.adjacent ?? []),
    ...(future.classification.transferable ?? []),
    ...(future.classification.gaps ?? []),
  ];
  const total = items.length;
  if (total === 0) {
    return { score: future.score, developmentPlan: [], alreadyMet: [], metSkills: 0, total: 0 };
  }
  const attainments = items.map(attainmentFor);
  const sDirect = attainments.reduce((a, b) => a + b, 0) / total;
  const score =
    PROJ_WEIGHTS.direct * sDirect +
    PROJ_WEIGHTS.adjacent * future.sections.adjacent.value +
    PROJ_WEIGHTS.evidence * future.sections.evidence.value +
    PROJ_WEIGHTS.seniority * future.sections.seniority.value;

  const developmentPlan: DevelopmentStep[] = items
    .map((item, i) => ({ skill: item.skill, basis: item.classification, attainment: attainments[i] }))
    .filter((d) => d.attainment < DEVELOPMENT_ATTAINMENT.met)
    .sort((a, b) => b.attainment - a.attainment);
  const alreadyMet = items.filter((i) => attainmentFor(i) >= DEVELOPMENT_ATTAINMENT.met);

  return {
    score: round3(score),
    developmentPlan,
    alreadyMet,
    metSkills: alreadyMet.length,
    total,
  };
}
