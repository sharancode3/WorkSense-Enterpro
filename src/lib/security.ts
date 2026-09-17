/**
 * Field-level protection contract for the candidate view.
 * A candidate requesting any of these receives an explicit 403 from the
 * candidate-status backend function — never a silent omission.
 */
export const PROTECTED_FIELDS = [
  "score",
  "rubric",
  "notes",
  "computed_fits",
  "interview_rubrics",
  "match_score",
  "audit_events",
] as const;

export type ProtectedField = (typeof PROTECTED_FIELDS)[number];

export function isProtectedField(field: string): boolean {
  return (PROTECTED_FIELDS as readonly string[]).includes(field);
}

export function forbiddenIncludes(include: string[] | undefined): string[] {
  return (include ?? []).filter((f) => isProtectedField(f));
}
