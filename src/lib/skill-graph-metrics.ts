// Batch E (E1/E2): pure, client-free helpers shared with the Skill Graph page
// and unit tests. Kept separate from skill-graph.ts because that module
// instantiates the Supabase client at import time (not available in node test
// environments).
import type { FitItem, SkillAssertion } from "./skill-graph";

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
