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
 * §53: computed "projected future readiness (with planned development)".
 *
 * The raw future score answers "today's profile vs tomorrow's requirement
 * set" — a harder future target can legitimately score LOWER than today. That
 * baseline stays untouched. This helper models the person actually LEARNING:
 * it assumes every future requirement that already has a real foundation
 * (a partial direct claim, an adjacent graph edge, or a transferable edge) is
 * trained up to the target bar, then recomputes the SAME weighted composite
 * the engine uses (50/25/15/10). Pure gaps with no recorded foundation stay
 * open. Because each foundation-backed requirement contributes at least as
 * much as it did before, the projected score is ALWAYS >= the raw future
 * score — growth from evidence-grounded development, never a fabricated 100.
 */
export function projectedFutureReadiness(future: FitRecord): {
  score: number;
  closable: FitItem[];
  remaining: FitItem[];
  directMet: number;
  total: number;
} {
  const direct = future.classification.direct ?? [];
  const adjacent = future.classification.adjacent ?? [];
  const transferable = future.classification.transferable ?? [];
  const gaps = future.classification.gaps ?? [];
  const total = direct.length + adjacent.length + transferable.length + gaps.length;
  if (total === 0) {
    return { score: future.score, closable: [], remaining: [], directMet: 0, total: 0 };
  }
  const alreadyMet = direct.filter((i) => (i.candidate_proficiency ?? 0) >= i.required_proficiency).length;
  const closable = [
    ...direct.filter((i) => (i.candidate_proficiency ?? 0) < i.required_proficiency),
    ...adjacent,
    ...transferable,
  ];
  const sDirect = (alreadyMet + closable.length) / total;
  const sAdjacent = gaps.length === 0 ? 1 : future.sections.adjacent.value;
  const score =
    PROJ_WEIGHTS.direct * sDirect +
    PROJ_WEIGHTS.adjacent * sAdjacent +
    PROJ_WEIGHTS.evidence * future.sections.evidence.value +
    PROJ_WEIGHTS.seniority * future.sections.seniority.value;
  return { score: round3(score), closable, remaining: gaps, directMet: alreadyMet, total };
}
