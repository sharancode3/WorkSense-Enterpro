import { describe, expect, it } from "vitest";
import { isInputFingerprintOutdated, isProposalStale } from "../staffing-staleness";

describe("isInputFingerprintOutdated (dirty-input protection)", () => {
  it("is false when no plan has been computed yet", () => {
    expect(isInputFingerprintOutdated(false, null, "{}")).toBe(false);
  });

  it("is false when the fingerprint is untouched (identical inputs)", () => {
    const fp = JSON.stringify({ a: 1 });
    expect(isInputFingerprintOutdated(true, fp, fp)).toBe(false);
  });

  it("is true when the inputs changed after the plan was computed", () => {
    expect(isInputFingerprintOutdated(true, "v1", "v2")).toBe(true);
  });

  it("is false while inputs are pristine even if no fingerprint was ever stored", () => {
    expect(isInputFingerprintOutdated(true, null, "v1")).toBe(false);
  });
});

describe("isProposalStale (bound scenario version vs current plan)", () => {
  it("is false when the proposal binds the version the plan currently runs on", () => {
    expect(isProposalStale("assumptions-v3", "assumptions-v3")).toBe(false);
  });

  it("is true when the plan was recalculated onto a newer assumptions version", () => {
    expect(isProposalStale("assumptions-v3", "assumptions-v4")).toBe(true);
  });

  it("is true when the proposal binds a version that no longer exists", () => {
    expect(isProposalStale("assumptions-v2", "assumptions-v5")).toBe(true);
  });

  it("treats unknown version strings conservatively as a mismatch unless equal", () => {
    expect(isProposalStale("?", "assumptions-v3")).toBe(true);
    expect(isProposalStale("?", "?")).toBe(false);
  });
});
