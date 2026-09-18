import { describe, expect, it } from "vitest";
import {
  applyWaivers,
  CycleError,
  NON_WAIVABLE_TASK_IDS,
  schedulePlan,
  type TaskInput,
} from "./onboarding-engine.ts";

const CORE: TaskInput[] = [
  { id: "it", title: "IT & Laptop Provisioning", depends_on: [], duration_days: 1 },
  { id: "security", title: "Security & Compliance Training", depends_on: [], non_waivable: true, duration_days: 1 },
  { id: "payroll", title: "Direct Deposit & Payroll Setup", depends_on: [], non_waivable: true, duration_days: 0.5 },
  { id: "access", title: "System Access & SSO", depends_on: ["it", "security"], duration_days: 0.5 },
  { id: "compliance_signoff", title: "Compliance Sign-off", depends_on: ["security"], non_waivable: true, duration_days: 0.5 },
  { id: "first_task", title: "First contribution with Go", skill: "Go", target_proficiency: 3, depends_on: ["access"], duration_days: 1 },
  { id: "survey", title: "Onboarding Feedback Survey", depends_on: ["first_task"], duration_days: 0.5 },
];

const START = "2026-09-01T09:00:00Z";

describe("Bloom-style waiver rule", () => {
  it("waives a foundational task when verified proficiency meets the target", () => {
    const res = applyWaivers(CORE, [{ name: "Go", proficiency: 4 }]);
    expect(res.waived).toContain("first_task");
    expect(res.required).not.toContain("first_task");
  });

  it("keeps a task REQUIRED when proficiency is below target", () => {
    const res = applyWaivers(CORE, [{ name: "Go", proficiency: 2 }]);
    expect(res.required).toContain("first_task");
  });

  it("never waives non-waivable tasks even with top proficiency", () => {
    const res = applyWaivers(CORE, [
      { name: "Go", proficiency: 5 },
      { name: "Security", proficiency: 5 },
    ]);
    for (const id of NON_WAIVABLE_TASK_IDS) {
      expect(res.required).toContain(id);
    }
    expect(res.waived).not.toContain("security");
  });
});

describe("Kahn's topological scheduler", () => {
  it("produces a valid topological order (dependencies before dependents)", () => {
    const sched = schedulePlan({ tasks: CORE, skills: [], startDate: START });
    const order = sched.map((t) => t.id);
    const idx = (id: string) => order.indexOf(id);
    expect(idx("access")).toBeGreaterThan(idx("it"));
    expect(idx("access")).toBeGreaterThan(idx("security"));
    expect(idx("first_task")).toBeGreaterThan(idx("access"));
    expect(idx("survey")).toBeGreaterThan(idx("first_task"));
    expect(sched.every((t) => t.start_date !== null)).toBe(true);
  });

  it("raises a CycleError on circular dependencies — never reaches the UI", () => {
    const cyclic: TaskInput[] = [
      { id: "a", depends_on: ["b"], duration_days: 1 },
      { id: "b", depends_on: ["c"], duration_days: 1 },
      { id: "c", depends_on: ["a"], duration_days: 1 },
    ];
    expect(() => schedulePlan({ tasks: cyclic, skills: [], startDate: START })).toThrow(CycleError);
  });

  it("rejects unknown dependencies", () => {
    const bad: TaskInput[] = [{ id: "a", depends_on: ["ghost"], duration_days: 1 }];
    expect(() => schedulePlan({ tasks: bad, skills: [], startDate: START })).toThrow(/unknown task/);
  });
});

describe("date assignment", () => {
  it("starts a dependent after its prerequisite ends", () => {
    const sched = schedulePlan({ tasks: CORE, skills: [], startDate: START });
    const access = sched.find((t) => t.id === "access")!;
    const it = sched.find((t) => t.id === "it")!;
    expect(new Date(access.start_date!).getTime()).toBeGreaterThanOrEqual(
      new Date(it.end_date!).getTime()
    );
  });

  it("assigns end = start + duration", () => {
    const sched = schedulePlan({ tasks: CORE, skills: [], startDate: START });
    const it = sched.find((t) => t.id === "it")!;
    expect(new Date(it.end_date!).getTime() - new Date(it.start_date!).getTime()).toBe(
      1 * 24 * 60 * 60 * 1000
    );
  });

  it("marks waived tasks and keeps their dates in the graph", () => {
    const sched = schedulePlan({ tasks: CORE, skills: [{ name: "Go", proficiency: 4 }], startDate: START });
    const ft = sched.find((t) => t.id === "first_task")!;
    expect(ft.waived).toBe(true);
    expect(ft.status).toBe("waived");
    expect(ft.start_date).not.toBeNull();
    const survey = sched.find((t) => t.id === "survey")!;
    expect(new Date(survey.start_date!).getTime()).toBeGreaterThanOrEqual(new Date(ft.end_date!).getTime());
  });
});

describe("blocker handling", () => {
  it("recomputes downstream dates to null when a prerequisite is blocked", () => {
    const blocked = { taskId: "it", note: "laptop not delivered", reported_by: "employee@x", at: START };
    const sched = schedulePlan({ tasks: CORE, skills: [], startDate: START, blocked });
    const it = sched.find((t) => t.id === "it")!;
    expect(it.status).toBe("blocked");
    expect(it.start_date).toBeNull();
    // Everything downstream of 'it' is waiting.
    for (const id of ["access", "first_task", "survey"]) {
      const t = sched.find((x) => x.id === id)!;
      expect(t.start_date).toBeNull();
    }
    // Parallel branch unaffected.
    const payroll = sched.find((t) => t.id === "payroll")!;
    expect(payroll.start_date).not.toBeNull();
  });

  it("preserves completed task status", () => {
    const sched = schedulePlan({ tasks: CORE, skills: [], startDate: START, doneTaskIds: ["it"] });
    expect(sched.find((t) => t.id === "it")!.status).toBe("done");
  });
});
