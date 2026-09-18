import { describe, expect, it } from "vitest";
import { buildPlanDefs, deriveStates, estimateReadiness, materialize, planHash, type PlanTask, type TaskDef } from "./onboarding-v2.ts";
import { buildOnboardingQueue, STALL_DAYS } from "./onboarding-queue.ts";

const REQ = {
  title: "Senior Backend Engineer",
  required_skills: [
    { skill: "Go", target_proficiency: 4 },
    { skill: "PostgreSQL", target_proficiency: 3 },
  ],
  future_skills: [{ skill: "Kubernetes", target_proficiency: 2 }],
  seniority_level: 4,
};

const POLICIES = [{ doc_code: "POL-SEC", title: "Equipment & Security Policy" }];

function planWith(facts: { done?: string[]; waived?: string[]; blockers?: Record<string, { id: string; note: string; reported_by: string; at: string; status: "open" | "resolved" }[]> }): { defs: TaskDef[]; tasks: PlanTask[] } {
  const defs = buildPlanDefs({ role: REQ, verified_skills: [], policy_docs: POLICIES });
  const tasks = materialize(
    deriveStates(defs, { approved: true, startDate: "2026-09-01T09:00:00Z", done: facts.done ?? [], waived: facts.waived ?? [], blockers: facts.blockers }),
    { blockers: facts.blockers ?? {} }
  );
  return { defs, tasks };
}

describe("estimateReadiness (Phase 6 readiness dimensions)", () => {
  it("shows access, compliance and capability readiness separately from completion", () => {
    const { defs, tasks } = planWith({});
    const r = estimateReadiness(defs, tasks, "2026-09-01T09:00:00Z", "2026-09-18T09:00:00Z");
    const keys = r.dimensions.map((d) => d.key);
    expect(keys).toEqual(["access", "compliance", "capability"]);
    // Nothing done yet: all zero.
    expect(r.dimensions.every((d) => d.satisfied === 0)).toBe(true);
    expect(r.ready_pct).toBe(0);
  });

  it("waived learning tasks never count as capability (spec 15)", () => {
    const { defs, tasks } = planWith({});
    // Find a learning task code and waive it.
    const learn = defs.find((d) => d.task_type === "learning");
    expect(learn).toBeDefined();
    const { defs: d2, tasks: t2 } = planWith({ waived: [learn!.task_code] });
    const r = estimateReadiness(d2, t2, "2026-09-01T09:00:00Z", "2026-09-18T09:00:00Z");
    const capability = r.dimensions.find((d) => d.key === "capability")!;
    // Waived is NOT satisfied for capability (no skill verified).
    expect(capability.satisfied).toBe(0);
    // But waived still counts toward overall task completion.
    expect(r.satisfied).toBe(1);
  });

  it("critical path uses remaining durations, not node count (spec 16)", () => {
    const defs = buildPlanDefs({ role: REQ, verified_skills: [], policy_docs: POLICIES });
    const { tasks: allDone } = planWith({});
    // Empty plan start: critical path should be ordered by level and its days
    // equal the sum of durations along the longest-by-duration chain.
    const tasks = allDone.map((t) => ({ ...t, state: "pending" as const }));
    const r = estimateReadiness(defs, tasks, "2026-09-01T09:00:00Z", "2026-09-18T09:00:00Z");
    expect(r.critical_path.length).toBeGreaterThan(0);
    // Longest chain in the seed plan is the skill-gap chain (it_provisioning →
    // access_sso → team_intro → learn_go → verify_go...). The first node must
    // be a level-0 task and the sum of durations must equal remaining days.
    const byCode = new Map(defs.map((d) => [d.task_code, d]));
    const sum = r.critical_path.reduce((n, c) => n + (byCode.get(c)?.duration_days ?? 0), 0);
    expect(r.remaining_critical_days).toBeGreaterThan(0);
    // The skill-gap chain (through learn_go) is on the path.
    expect(r.critical_path.includes("learn_go")).toBe(true);
    expect(r.critical_path.includes("it_provisioning")).toBe(true);
    expect(sum).toBe(r.remaining_critical_days);
  });

  it("labels the projection provisional and unknown when blockers are on the path (spec 17/18)", () => {
    const { defs, tasks } = planWith({
      blockers: { access_sso: [{ id: "b1", note: "laptop pending", reported_by: "elena", at: "2026-09-15T09:00:00Z", status: "open" }] },
    });
    const r = estimateReadiness(defs, tasks, "2026-09-01T09:00:00Z", "2026-09-18T09:00:00Z");
    expect(r.provisional).toBe(true);
    expect(r.projected_ready_date).toBeNull();
    expect(r.note).toContain("provisional");
  });

  it("projects a business-day date when nothing is blocked", () => {
    const { defs, tasks } = planWith({ done: ["it_provisioning", "security_training"] });
    const r = estimateReadiness(defs, tasks, "2026-09-01T09:00:00Z", "2026-09-18T09:00:00Z");
    expect(r.provisional).toBe(false);
    expect(r.projected_ready_date).not.toBeNull();
    expect(r.working_calendar).toBe("business_days");
    // 2026-09-18 is a Friday. Remaining path ≈ 3.5d -> 4 working days:
    // Mon 09-21, Tue 09-22, Wed 09-23, Thu 09-24 (weekends skipped).
    expect(r.projected_ready_date?.startsWith("2026-09-24")).toBe(true);
  });
});

describe("buildOnboardingQueue (Phase 6 role queues)", () => {
  const mkJourney = (over: Partial<Parameters<typeof buildOnboardingQueue>[0]["journeys"][number]> = {}) => ({
    plan: {
      id: "p1",
      twin_id: "t1",
      version: 2,
      status: "approved",
      start_date: "2026-09-01T09:00:00Z",
      readiness: { ready_pct: 40, projected_ready_date: "2026-09-25T09:00:00Z", provisional: false, blocked_count: 1 },
      manager_approval: { at: "2026-09-02T09:00:00Z" },
      hr_approval: { at: "2026-09-03T09:00:00Z" },
    },
    employee: { id: "t1", name: "Alex Chen", job_title: "Engineer", manager_id: "m1" },
    tasks: [
      { task_code: "it_provisioning", title: "IT & Laptop Provisioning", task_type: "provisioning", owner_role: "it_security", state: "ready", due_date: "2026-09-10T09:00:00Z", topological_level: 0, depends_on: [], blockers: [] },
      { task_code: "security_training", title: "Security & Compliance Training", task_type: "policy", owner_role: "employee", state: "done", due_date: "2026-09-08T09:00:00Z", topological_level: 0, depends_on: [], blockers: [] },
      { task_code: "access_sso", title: "System Access & SSO", task_type: "access", owner_role: "it_security", state: "blocked", due_date: "2026-09-12T09:00:00Z", topological_level: 1, depends_on: ["it_provisioning", "security_training"], blockers: [{ status: "open", at: "2026-09-11T09:00:00Z" }] },
      { task_code: "team_intro", title: "Team Introduction", task_type: "onboarding_admin", owner_role: "manager", state: "pending", due_date: null, topological_level: 2, depends_on: ["access_sso"], blockers: [] },
      { task_code: "learn_go", title: "First contribution using Go", task_type: "learning", owner_role: "employee", state: "pending", due_date: null, topological_level: 3, depends_on: ["team_intro"], blockers: [] },
    ],
    ...over,
  });

  it("marks a journey stalled when a blocker is open", () => {
    const now = "2026-09-18T09:00:00Z";
    const res = buildOnboardingQueue({ role: "hr", journeys: [mkJourney()], now });
    expect(res.journeys[0].stalled).toBe(true);
    expect(res.journeys[0].stall_reasons[0]).toContain("open blocker");
  });

  it("marks a journey overdue when an actionable task is past due", () => {
    const now = "2026-09-18T09:00:00Z";
    const j = mkJourney({ plan: { id: "p1", twin_id: "t1", version: 1, status: "approved", start_date: "2026-09-01T09:00:00Z", readiness: {}, manager_approval: null, hr_approval: null } });
    const res = buildOnboardingQueue({ role: "manager", journeys: [j], now });
    // it_provisioning is ready and past its due date (09-10).
    expect(res.journeys[0].overdue).toBe(true);
    expect(res.journeys[0].overdue_count).toBe(1);
  });

  it("exposes the employee's waiting-on tasks (owned by others, unmet deps)", () => {
    const now = "2026-09-18T09:00:00Z";
    const res = buildOnboardingQueue({ role: "employee", journeys: [mkJourney()], now });
    const waitingCodes = res.journeys[0].waiting_on.map((t) => t.task_code);
    // learn_go (employee) needs team_intro (manager) which is pending behind
    // the open access_sso blocker — the employee is waiting on team_intro.
    expect(waitingCodes).toContain("team_intro");
    expect(res.journeys[0].stalled).toBe(true);
  });

  it("scopes viewer actions per role (IT sees provisioning/access only)", () => {
    const now = "2026-09-18T09:00:00Z";
    const res = buildOnboardingQueue({ role: "it_security", journeys: [mkJourney()], now });
    const codes = res.journeys[0].viewer_actions.map((t) => t.task_code);
    expect(codes).toContain("it_provisioning");
    expect(codes).toContain("access_sso");
    expect(codes).not.toContain("team_intro");
    expect(res.provisioning.length).toBeGreaterThan(0);
  });

  it("never lists employee-owned tasks as manager viewer actions (spec 12)", () => {
    const now = "2026-09-18T09:00:00Z";
    const res = buildOnboardingQueue({ role: "manager", journeys: [mkJourney()], now });
    const codes = res.journeys[0].viewer_actions.map((t) => t.task_code);
    expect(codes).toContain("team_intro");
    expect(codes).not.toContain("learn_go");
    expect(codes).not.toContain("security_training");
  });

  it("detects stalled via overdue beyond the stall window", () => {
    const now = "2026-09-18T09:00:00Z";
    const staleDue = new Date(new Date(now).getTime() - (STALL_DAYS + 1) * 86400000).toISOString();
    const j = mkJourney({
      plan: { id: "p1", twin_id: "t1", version: 1, status: "approved", start_date: "2026-09-01T09:00:00Z", readiness: {}, manager_approval: null, hr_approval: null },
      tasks: [{ task_code: "it_provisioning", title: "IT & Laptop Provisioning", task_type: "provisioning", owner_role: "it_security", state: "ready", due_date: staleDue, topological_level: 0, depends_on: [], blockers: [] }],
    });
    const res = buildOnboardingQueue({ role: "hr", journeys: [j], now });
    expect(res.journeys[0].stalled).toBe(true);
    expect(res.journeys[0].stall_reasons.some((s) => s.includes("overdue"))).toBe(true);
  });
});

describe("planHash stability", () => {
  it("hashes identical defs to the same value", () => {
    const a = buildPlanDefs({ role: REQ, verified_skills: [], policy_docs: POLICIES });
    const b = buildPlanDefs({ role: REQ, verified_skills: [], policy_docs: POLICIES });
    expect(planHash(a)).toBe(planHash(b));
  });
});
