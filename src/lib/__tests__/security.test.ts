import { describe, expect, it } from "vitest";
import {
  forbiddenIncludes,
  isProtectedField,
  PROTECTED_FIELDS,
} from "@/lib/security";

describe("candidate protected fields (403 contract)", () => {
  it("flags every score/rubric/notes/internal field as protected", () => {
    for (const field of PROTECTED_FIELDS) {
      expect(isProtectedField(field)).toBe(true);
    }
  });

  it("returns no forbidden fields for a public request", () => {
    expect(forbiddenIncludes(undefined)).toEqual([]);
    expect(forbiddenIncludes([])).toEqual([]);
    expect(forbiddenIncludes(["status", "skills"])).toEqual([]);
  });

  it("returns exactly the protected fields when requested", () => {
    expect(forbiddenIncludes(["score", "rubric", "notes"])).toEqual(["score", "rubric", "notes"]);
    expect(forbiddenIncludes(["status", "score", "skills", "computed_fits"])).toEqual([
      "score",
      "computed_fits",
    ]);
  });

  it("never silently drops a protected field — it surfaces it for a 403", () => {
    const requested = ["application_status", "match_score", "interview_rubrics"];
    expect(forbiddenIncludes(requested)).toContain("match_score");
    expect(forbiddenIncludes(requested)).toContain("interview_rubrics");
    expect(forbiddenIncludes(requested)).not.toContain("application_status");
  });
});
