import { describe, expect, it } from "vitest";
import {
  checkStale,
  resolveTransition,
  STAGE_LABELS,
  STAGE_ORDER,
} from "./stage-engine.ts";

describe("stage transition matrix", () => {
  it("advances along the pipeline with move_forward", () => {
    expect(resolveTransition("screening", "move_forward")).toEqual({ ok: true, newStage: "technical_interview" });
    expect(resolveTransition("technical_interview", "move_forward")).toEqual({ ok: true, newStage: "final_round" });
  });

  it("selects only from the final round", () => {
    expect(resolveTransition("final_round", "select")).toEqual({ ok: true, newStage: "selected" });
    expect(resolveTransition("screening", "select").ok).toBe(false);
    expect(resolveTransition("technical_interview", "select").ok).toBe(false);
  });

  it("rejects from any open stage", () => {
    for (const stage of ["screening", "technical_interview", "final_round"]) {
      expect(resolveTransition(stage, "reject")).toEqual({ ok: true, newStage: "rejected" });
    }
  });

  it("blocks forward movement from the final round", () => {
    const res = resolveTransition("final_round", "move_forward");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("TRANSITION_DENIED");
  });

  it("blocks transitions from terminal stages", () => {
    for (const terminal of ["selected", "rejected"]) {
      for (const decision of ["move_forward", "select", "reject"]) {
        const res = resolveTransition(terminal, decision);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.code).toBe("STAGE_TERMINAL");
      }
    }
  });

  it("rejects unknown stages and decisions", () => {
    expect(resolveTransition("nonsense", "move_forward").ok).toBe(false);
    expect(resolveTransition("screening", "explode").ok).toBe(false);
  });

  it("covers every stage with a label", () => {
    for (const stage of STAGE_ORDER) expect(STAGE_LABELS[stage]).toBeTruthy();
  });
});

describe("stale-state conflict detection", () => {
  it("is not stale when expectations match reality", () => {
    expect(checkStale("screening", 2, "screening", 2).stale).toBe(false);
  });

  it("flags a stage mismatch", () => {
    const s = checkStale("technical_interview", 2, "screening", 2);
    expect(s.stale).toBe(true);
    expect(s.currentStage).toBe("screening");
  });

  it("flags a version mismatch", () => {
    const s = checkStale("screening", 1, "screening", 3);
    expect(s.stale).toBe(true);
    expect(s.currentVersion).toBe(3);
  });

  it("ignores an omitted expectation", () => {
    expect(checkStale(undefined, undefined, "screening", 4).stale).toBe(false);
  });
});
