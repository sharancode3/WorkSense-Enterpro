import { describe, expect, it } from "vitest";
import {
  buildTasksForCategory,
  canTransitionRec,
  canTransitionTask,
  candidateSourceHash,
  nextRecStatus,
  nextTaskStatus,
} from "./workflow-engine.ts";

describe("workflow-engine (Phase 11)", () => {
  it("enforces the full recommendation lifecycle with allowed transitions only", () => {
    expect(nextRecStatus("suggested", "submit")).toBe("needs_review");
    expect(nextRecStatus("needs_review", "approve")).toBe("approved");
    expect(nextRecStatus("needs_review", "reject")).toBe("rejected");
    expect(nextRecStatus("approved", "dispatch")).toBe("execution_pending");
    expect(nextRecStatus("execution_pending", "start")).toBe("in_progress");
    expect(nextRecStatus("in_progress", "complete")).toBe("completed");
    expect(nextRecStatus("in_progress", "fail")).toBe("failed");
    expect(nextRecStatus("failed", "start")).toBe("in_progress"); // recoverable retry
    expect(nextRecStatus("stale", "re_review")).toBe("needs_review");
  });

  it("rejects illegal transitions instead of assigning arbitrary statuses", () => {
    expect(canTransitionRec("approved", "approve")).toBe(false); // can't approve twice
    expect(canTransitionRec("suggested", "dispatch")).toBe(false);
    expect(canTransitionRec("completed", "complete")).toBe(false);
    expect(canTransitionRec("rejected", "approve")).toBe(false);
    expect(nextRecStatus("suggested", "approve")).toBeNull();
  });

  it("rejects arbitrary statuses (no direct status write path)", () => {
    expect(canTransitionRec("needs_review", "execution_pending")).toBe(false);
    expect(nextRecStatus("needs_review", "in_progress")).toBeNull();
  });

  it("enforces the task lifecycle with recoverable failures", () => {
    expect(nextTaskStatus("open", "start")).toBe("in_progress");
    expect(nextTaskStatus("in_progress", "block")).toBe("blocked");
    expect(nextTaskStatus("blocked", "complete")).toBe("completed");
    expect(nextTaskStatus("in_progress", "fail")).toBe("failed");
    expect(nextTaskStatus("failed", "retry")).toBe("in_progress");
    expect(canTransitionTask("completed", "fail")).toBe(false);
    expect(canTransitionTask("open", "complete")).toBe(false); // must start first
  });

  it("builds per-category tasks with evidence + outcome measures", () => {
    const workforce = buildTasksForCategory("workforce_review", "t1", "m1");
    expect(workforce.length).toBeGreaterThanOrEqual(2);
    expect(workforce[0].owner_role).toBe("manager");
    expect(workforce[0].required_evidence.length).toBeGreaterThan(0);
    expect(workforce[0].outcome_measure).toBeDefined();

    const dev = buildTasksForCategory("development_support", "t1", "m1");
    expect(dev.some((t) => t.owner_role === "employee")).toBe(true); // targeted learning
    expect(dev.some((t) => t.owner_role === "reviewer")).toBe(true); // capability verification

    const recruit = buildTasksForCategory("recruitment_review", "t1", "m1");
    expect(recruit.every((t) => t.owner_role === "recruiter")).toBe(true); // recruiter reviews gaps
  });

  it("candidate source hash is stable and changes when the evidence changes", () => {
    const a = candidateSourceHash({ category: "mobility", twin_id: "t1", evidence: [{ source: "SKILL_GRAPH", fact: "x" }] });
    expect(a).toBe(candidateSourceHash({ category: "mobility", twin_id: "t1", evidence: [{ source: "SKILL_GRAPH", fact: "x" }] }));
    expect(a).not.toBe(candidateSourceHash({ category: "mobility", twin_id: "t1", evidence: [{ source: "SKILL_GRAPH", fact: "y" }] }));
  });
});
