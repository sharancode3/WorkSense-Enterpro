import type { PlannerOption } from "./api";

// Batch F (F2): the staffing planner makes its recommendation rule EXPLICIT.
// Deterministic, derived from the engine's validated numbers — the rule is
// never an LLM judgment.
export const RECOMMENDATION_RULE =
  "Recommended: among the options that satisfy every mandatory skill within the deadline AND the budget, the one with the highest verified coverage; ties are broken by lower cost, then earlier ready date. If no option satisfies both constraints, no recommendation is made — each option shows why it fails.";

export const RECOMMENDATION_RULE_SHORT =
  "highest verified coverage among options that satisfy every mandatory skill within deadline AND budget (ties: lower cost, then earlier ready date)";

/**
 * Returns the recommended option id, or null when no option satisfies every
 * mandatory skill within the deadline AND budget.
 */
export function recommendOption(options: PlannerOption[]): string | null {
  const eligible = (options ?? []).filter(
    (o) => o.mandatory_satisfied && o.meets_deadline && o.budget_satisfied
  );
  if (eligible.length === 0) return null;
  return [...eligible].sort(
    (a, b) =>
      b.verified_coverage_pct - a.verified_coverage_pct ||
      a.cost_usd - b.cost_usd ||
      a.ready_at_days - b.ready_at_days
  )[0].id;
}
