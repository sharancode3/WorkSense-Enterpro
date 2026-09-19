// Phase 9: pure, client-free helpers shared with the Skill Graph page and unit
// tests. Kept separate from skill-graph.ts because that module instantiates the
// Supabase client at import time (not available in node test environments).
//
// The old §55 "projected with development" model (fixed attainment constants
// 1/0.9/0.85/0.6/0.35 presented as a computed trajectory) is REMOVED: a fixed
// learning assumption must never be labeled a prediction. Development forecasts
// exist only when a real, approved development plan does; otherwise the UI
// shows "Forecast not available" with the reason. A clearly-labeled scenario
// estimate (with assumptions and a confidence band) may be shown alongside —
// never as measured capability.
import type { FitItem, FitRecord } from "./skill-graph";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const norm = (s: string) => s.trim().toLowerCase();

/** E1: how the future requirement set differs from the current one. */
export function futureRequirementDiff(
  current: { skill: string; target_proficiency: number }[],
  future: { skill: string; target_proficiency: number }[]
): { added: { skill: string; target_proficiency: number }[]; raised: { skill: string; target_proficiency: number }[]; removed: { skill: string; target_proficiency: number }[] } {
  const curMap = new Map(current.map((s) => [norm(s.skill), s]));
  const futMap = new Map(future.map((s) => [norm(s.skill), s]));
  return {
    added: future.filter((s) => !curMap.has(norm(s.skill))),
    raised: future.filter((s) => curMap.has(norm(s.skill)) && s.target_proficiency > curMap.get(norm(s.skill))!.target_proficiency),
    removed: current.filter((s) => !futMap.has(norm(s.skill))),
  };
}

/**
 * Phase 9 mirror of the engine's resolveFutureRequirements: the resolved
 * 12–24 month target. The authoritative resolved set lives in the future fit's
 * scoring.requirements (server-computed); this helper is for displaying the
 * derivation diff in the UI.
 */
export function resolvedFutureRequirements(
  current: { skill: string; target_proficiency: number; mandatory?: boolean }[],
  future: { skill: string; target_proficiency: number; mandatory?: boolean }[],
  obsolete: { skill: string; target_proficiency: number }[] = []
): { resolved: { skill: string; target_proficiency: number; mandatory?: boolean }[]; kept: string[]; added: string[]; raised: string[]; obsolete: string[] } {
  const obsKeys = new Set(obsolete.map((o) => norm(o.skill)));
  const curMap = new Map(current.map((s) => [norm(s.skill), s]));
  const futMap = new Map(future.map((s) => [norm(s.skill), s]));
  const resolved: { skill: string; target_proficiency: number; mandatory?: boolean }[] = [];
  const kept: string[] = [];
  const added: string[] = [];
  const raised: string[] = [];
  for (const cur of current) {
    const k = norm(cur.skill);
    if (obsKeys.has(k)) continue;
    const fut = futMap.get(k);
    if (fut) {
      resolved.push({ ...cur, target_proficiency: fut.target_proficiency });
      if (fut.target_proficiency > cur.target_proficiency) raised.push(cur.skill);
      else kept.push(cur.skill);
    } else {
      resolved.push(cur);
      kept.push(cur.skill);
    }
  }
  for (const fut of future) {
    const k = norm(fut.skill);
    if (curMap.has(k)) continue;
    resolved.push({ ...fut, mandatory: false });
    added.push(fut.skill);
  }
  return { resolved, kept, added, raised, obsolete: [...obsKeys] };
}

/**
 * E2: verified / unverified / missing across the DIRECT relationships of a fit.
 * "Verified" = reviewer-confirmed or assessment-supported assertion.
 * "Unverified" = self-reported/extracted. "Missing" = no recorded assertion.
 */
export function coverageBreakdown(
  direct: FitItem[],
  assertions: { skill_name: string | null; review_state: string }[]
): { directTotal: number; verified: number; unverified: number; missing: number } {
  let verified = 0;
  let unverified = 0;
  let missing = 0;
  for (const item of direct) {
    const matches = assertions.filter((a) => norm(a.skill_name ?? "") === norm(item.skill));
    if (matches.length === 0) { missing += 1; continue; }
    if (matches.some((a) => a.review_state === "reviewer_confirmed" || a.review_state === "assessment_supported")) verified += 1;
    else unverified += 1;
  }
  return { directTotal: direct.length, verified, unverified, missing };
}

/**
 * A real development plan that would authorize a forecast. Learning tasks
 * assigned to a person do NOT qualify — only a plan with skill-specific
 * activities, baseline, target, method, hours, completion evidence, an
 * assessment gate, an owner and a due date can ground a forecast.
 */
export interface DevelopmentPlan {
  id: string;
  skills: { skill: string; baseline: number; target: number; activities: string; hours: number }[];
  assessment_gate: string;
  owner: string;
  due_date: string;
  approved: boolean;
}

export interface ForecastResult {
  available: boolean;
  reason: string;
  /** Deterministic planning estimate — an assumption, never measured. */
  estimate: { value: number; band: [number, number]; assumptions: string[]; note: string } | null;
}

/**
 * Development forecast. Available ONLY when an approved, complete development
 * plan exists for this person/role pairing. Otherwise the honest answer is
 * "Forecast not available" with the reason — a fixed learning assumption is
 * never labeled a prediction.
 */
export function developmentForecast(fit: FitRecord, plan: DevelopmentPlan | null | undefined): ForecastResult {
  if (!plan || !plan.approved) {
    return {
      available: false,
      reason: !plan
        ? "No development plan exists for this person against this role. A forecast is only computed from a real plan (per-skill activities, baseline, target, assessment gate, owner, due date) — assigned learning tasks alone are not evidence of achievement."
        : "The development plan exists but is not approved. Forecasts are only computed from approved plans.",
      estimate: null,
    };
  }
  const missing = plan.skills.filter(
    (s) =>
      !Number.isFinite(s.baseline) ||
      !Number.isFinite(s.target) ||
      s.target <= 0 ||
      !(s.activities ?? "").trim() ||
      !(s.hours > 0)
  );
  if (missing.length > 0) {
    return {
      available: false,
      reason: `The plan is approved but incomplete — missing details for ${missing.map((s) => s.skill).join(", ")} (baseline, target, activities or hours).`,
      estimate: null,
    };
  }
  const requirements = fit.scoring.requirements ?? [];
  const bySkill = new Map(requirements.map((r) => [norm(r.skill), r]));
  const achievable = plan.skills.map((s) => {
    const req = bySkill.get(norm(s.skill));
    const current = req?.effective_proficiency ?? 0;
    // Deterministic planning estimate: close the gap to target at plan pace.
    return { ...s, current, credit: Math.min(1, (current + Math.max(0, s.target - current) * 0.6) / s.target) };
  });
  const avgCredit = achievable.reduce((a, b) => a + b.credit, 0) / (achievable.length || 1);
  const estimate = round3(Math.max(fit.score, avgCredit));
  return {
    available: true,
    reason: `Forecast grounded in the approved plan "${plan.id}" (${plan.owner}, due ${plan.due_date}).`,
    estimate: {
      value: estimate,
      band: [round3(Math.max(fit.score, estimate - 0.12)), round3(Math.min(1, estimate + 0.12))],
      assumptions: [
        "Scenario estimate, not a measured capability: it assumes the plan's activities are completed and the assessment gate is passed.",
        `Closure assumed at a deterministic 60% of each remaining gap (baseline→target) over the plan's horizon.`,
        `Only skills in the plan are credited; the assessment gate must confirm achievement before readiness updates.`,
      ],
      note: "This is a planning estimate with a wide confidence band. Readiness only updates after accepted assessment or reviewer-verified evidence.",
    },
  };
}
