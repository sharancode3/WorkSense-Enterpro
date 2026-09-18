import { describe, expect, it } from "vitest";
import {
  adaptLearningToVerification,
  applyWaiver,
  attemptHash,
  buildCarryover,
  buildPlanDefs,
  canActOnTask,
  canAdapt,
  canWaive,
  criticalPath,
  CycleError,
  deriveStates,
  estimateReadiness,
  failVerification,
  materialize,
  planHash,
  satisfiedSet,
  validateCompletion,
  validateDag,
  type Blocker,
  type CompletionRecord,
  type PlanTask,
  type TaskDef,
  type Waiver,
} from "./onboarding-v2.ts";

const DEFS: TaskDef[] = [
  { task_code: "it_provisioning", title: "IT & Laptop Provisioning", task_type: "provisioning", owner_role: "it_security", required: true, non_waivable: true, depends_on: [], duration_days: 1, why_evidence: { reason: "r", source_evidence: [] }, evidence_requirements: [{ kind: "note", label: "Hardware & asset tag", required: true }] },
  { task_code: "security_training", title: "Security & Compliance Training", task_type: "policy", owner_role: "employee", required: true, non_waivable: true, depends_on: [], duration_days: 1, why_evidence: { reason: "r", source_evidence: [] }, evidence_requirements: [{ kind: "note", label: "Training ref", required: true }] },
  { task_code: "payroll", title: "Direct Deposit & Payroll Setup", task_type: "onboarding_admin", owner_role: "hr", required: true, non_waivable: true, depends_on: [], duration_days: 0.5, why_evidence: { reason: "r", source_evidence: [] }, evidence_requirements: [{ kind: "note", label: "Payroll ref", required: true }] },
  { task_code: "access_sso", title: "System Access & SSO Enrollment", task_type: "access", owner_role: "it_security", required: true, non_waivable: true, depends_on: ["it_provisioning", "security_training"], duration_days: 0.5, why_evidence: { reason: "r", source_evidence: [] }, evidence_requirements: [{ kind: "note", label: "MFA ref", required: true }] },
  { task_code: "team_intro", title: "Team Introduction", task_type: "onboarding_admin", owner_role: "manager", required: true, non_waivable: false, depends_on: ["access_sso"], duration_days: 1, why_evidence: { reason: "r", source_evidence: [] }, evidence_requirements: [{ kind: "note", label: "Walkthrough held", required: true }] },
  { task_code: "learn_go", title: "First contribution using Go", task_type: "learning", owner_role: "employee", required: true, non_waivable: false, depends_on: ["team_intro"], duration_days: 1, why_evidence: { reason: "r", source_evidence: [] }, evidence_requirements: [{ kind: "note", label: "Contribution evidence: Go", required: true }] },
  { task_code: "verify_go", title: "Verification: Go mastery assessment", task_type: "verification", owner_role: "employee", required: true, non_waivable: false, depends_on: ["learn_go"], duration_days: 0.5, why_evidence: { reason: "r", source_evidence: [] }, evidence_requirements: [{ kind: "assessment_id", label: "Assessment evidence id", required: true }] },
];

const START = "2026-09-01T09:00:00Z";
const NOW = "2026-09-10T09:00:00Z";

const employee = { id: "emp1", role: "employee", org_id: "org1" };
const manager = { id: "mgr1", role: "manager", org_id: "org1" };
const hr = { id: "hr1", role: "hr_executive", org_id: "org1" };
const hrPartner = { id: "hr2", role: "hr_partner", org_id: "org1" };
const itActor = { id: "it1", role: "it_security", org_id: "org1" };
const twin = { id: "emp1", manager_id: "mgr1", org_id: "org1" };

function taskOf(code: string, over: Partial<PlanTask> = {}): PlanTask {
  const d = DEFS.find((x) => x.task_code === code)!;
  return { ...d, state: "ready", start_date: START, due_date: START, topological_level: 0, blocked_reasons: [], blockers: [], waiver: null, completion_record: null, adaptation: null, ...over };
}

const done = (code: string): CompletionRecord => ({ actor_twin_id: "emp1", actor_name: "Emp", at: NOW, evidence: [], attempt_hash: "x" });

describe("plan hash binding", () => {
  it("hashes canonical definitions deterministically", () => {
    const a = planHash(DEFS);
    const b = planHash(DEFS.map((d) => ({ ...d })));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when task definitions change (regeneration invalidates old approvals)", () => {
    const changed = DEFS.map((d) => (d.task_code === "learn_go" ? { ...d, duration_days: 2 } : d));
    expect(planHash(changed)).not.toBe(planHash(DEFS));
  });

  it("attempt hashes dedupe identical submissions but not distinct ones", () => {
    const payload = { evidence: [{ kind: "note", label: "x", value: "abc" }] };
    expect(attemptHash("p1", "learn_go", "complete", payload)).toBe(attemptHash("p1", "learn_go", "complete", payload));
    expect(attemptHash("p1", "learn_go", "complete", payload)).not.toBe(attemptHash("p1", "learn_go", "complete", { evidence: [{ kind: "note", label: "x", value: "abd" }] }));
  });
});

describe("DAG validation", () => {
  it("accepts a valid plan", () => {
    expect(() => validateDag(DEFS)).not.toThrow();
  });

  it("rejects cyclic dependencies", () => {
    const cyclic: TaskDef[] = [
      DEFS[0],
      { ...DEFS[1], depends_on: ["access_sso"] },
      { ...DEFS[3], depends_on: ["security_training"] },
    ];
    expect(() => validateDag(cyclic)).toThrow(CycleError);
  });

  it("rejects missing dependencies", () => {
    const bad: TaskDef[] = [{ ...DEFS[4], depends_on: ["ghost"] }];
    expect(() => validateDag(bad)).toThrow(/unknown task/);
  });
});

describe("topological scheduling", () => {
  it("assigns topological levels and cascade dates", () => {
    const tasks = deriveStates(DEFS, { approved: true, startDate: START });
    const byCode = new Map(tasks.map((t) => [t.task_code, t]));
    expect(byCode.get("it_provisioning")!.topological_level).toBe(0);
    expect(byCode.get("access_sso")!.topological_level).toBe(1);
    expect(byCode.get("team_intro")!.topological_level).toBe(2);
    expect(byCode.get("learn_go")!.topological_level).toBe(3);
    expect(byCode.get("verify_go")!.topological_level).toBe(4);
    expect(new Date(byCode.get("access_sso")!.start_date!).getTime()).toBeGreaterThanOrEqual(
      new Date(byCode.get("it_provisioning")!.due_date!).getTime()
    );
  });

  it("marks pending states when plan is not approved", () => {
    const tasks = deriveStates(DEFS, { approved: false, startDate: START });
    expect(tasks.every((t) => t.state === "pending")).toBe(true);
    expect(tasks.every((t) => t.start_date !== null)).toBe(true); // planned timeline still shown
  });

  it("queues dependents (pending) with planned dates until deps are satisfied", () => {
    const tasks = deriveStates(DEFS, { approved: true, startDate: START });
    const byCode = new Map(tasks.map((t) => [t.task_code, t]));
    // Roots are ready; dependents are queued (not blocked) — nothing is blocked
    // until a dep is blocked/failed or an open blocker exists.
    expect(byCode.get("it_provisioning")!.state).toBe("ready");
    expect(byCode.get("security_training")!.state).toBe("ready");
    expect(byCode.get("payroll")!.state).toBe("ready");
    expect(byCode.get("access_sso")!.state).toBe("pending");
    expect(byCode.get("learn_go")!.state).toBe("pending");
    // Every planned date stays visible on the planned timeline.
    expect(tasks.every((t) => t.start_date !== null)).toBe(true);
  });
});

describe("blocked set + multiple simultaneous blockers", () => {
  it("queues a task until prerequisites are satisfied; cascades only from blocked/failed deps", () => {
    const blockers: Record<string, Blocker[]> = {};
    const tasks = materialize(
      deriveStates(DEFS, { approved: true, startDate: START, done: ["it_provisioning"], blockers }),
      {
        blockers,
        completion: { it_provisioning: done("it_provisioning") },
      }
    );
    const byCode = new Map(tasks.map((t) => [t.task_code, t]));
    // security_training is ready (not blocked) -> access_sso is QUEUED, not blocked.
    expect(byCode.get("access_sso")!.state).toBe("pending");
    expect(byCode.get("access_sso")!.blocked_reasons).toContain("security_training");
    expect(byCode.get("team_intro")!.state).toBe("pending");

    // When a prerequisite is itself BLOCKED (open blocker), downstream cascades.
    const cascaded = materialize(
      deriveStates(DEFS, {
        approved: true,
        startDate: START,
        done: ["it_provisioning"],
        blockers: { security_training: [{ id: "b1", note: "training platform down", reported_by: "it1", at: NOW, status: "open" }] },
      }),
      { blockers: { security_training: [{ id: "b1", note: "training platform down", reported_by: "it1", at: NOW, status: "open" }] } }
    );
    const cByCode = new Map(cascaded.map((t) => [t.task_code, t]));
    expect(cByCode.get("security_training")!.state).toBe("blocked");
    expect(cByCode.get("access_sso")!.state).toBe("blocked");
    expect(cByCode.get("verify_go")!.state).toBe("blocked");
  });

  it("supports multiple simultaneous open blockers; resolving one keeps others", () => {
    const blockers: Record<string, Blocker[]> = {
      access_sso: [
        { id: "b1", note: "hardware delay", reported_by: "it1", at: NOW, status: "open" },
        { id: "b2", note: "MFA app pending", reported_by: "it1", at: NOW, status: "open" },
      ],
    };
    const tasks = materialize(
      deriveStates(DEFS, { approved: true, startDate: START, blockers, done: ["it_provisioning", "security_training"] }),
      { blockers }
    );
    const access = tasks.find((t) => t.task_code === "access_sso")!;
    expect(access.state).toBe("blocked");
    expect(access.blockers.filter((b) => b.status === "open")).toHaveLength(2);

    // Resolve ONE blocker — the other stays open, task stays blocked.
    const resolved = access.blockers.map((b) => (b.id === "b1" ? { ...b, status: "resolved" as const } : b));
    const again = materialize(
      deriveStates(DEFS, { approved: true, startDate: START, blockers: { access_sso: resolved }, done: ["it_provisioning", "security_training"] }),
      { blockers: { access_sso: resolved } }
    ).find((t) => t.task_code === "access_sso")!;
    expect(again.blockers.filter((b) => b.status === "open")).toHaveLength(1);
    expect(again.state).toBe("blocked");

    // Resolving the LAST blocker unblocks it.
    const fully = resolved.map((b) => ({ ...b, status: "resolved" as const }));
    const done2 = materialize(
      deriveStates(DEFS, { approved: true, startDate: START, blockers: { access_sso: fully }, done: ["it_provisioning", "security_training"] }),
      { blockers: { access_sso: fully } }
    ).find((t) => t.task_code === "access_sso")!;
    expect(done2.state).toBe("ready");
  });
});

describe("critical path + honest readiness", () => {
  it("computes the longest remaining chain", () => {
    const cp = criticalPath(DEFS, new Set());
    expect(cp.tasks[0]).toBe("it_provisioning");
    expect(cp.tasks).toContain("verify_go");
    expect(cp.total_days).toBeGreaterThan(0);
  });

  it("estimates readiness without overclaiming", () => {
    const tasks = deriveStates(DEFS, { approved: true, startDate: START });
    const r = estimateReadiness(DEFS, tasks, START, NOW);
    expect(r.ready_pct).toBe(0);
    expect(r.total).toBe(DEFS.length);
    expect(r.note).toMatch(/not a guarantee/);
  });

  it("readiness rises as work completes", () => {
    const tasks = materialize(deriveStates(DEFS, { approved: true, startDate: START, done: ["it_provisioning", "security_training", "payroll"] }), {
      completion: { it_provisioning: done("it_provisioning"), security_training: done("security_training"), payroll: done("payroll") },
    });
    const r = estimateReadiness(DEFS, tasks, START, NOW);
    expect(r.ready_pct).toBeGreaterThan(0);
    expect(r.ready_pct).toBeLessThan(100);
  });
});

describe("authorization matrix", () => {
  it("employee can act on own employee-owned tasks only", () => {
    expect(canActOnTask(employee, "employee", twin).ok).toBe(true);
    expect(canActOnTask(employee, "manager", twin).ok).toBe(false);
    expect(canActOnTask(employee, "hr", twin).ok).toBe(false);
  });

  it("employee cannot claim IT provisioning (it_security owner)", () => {
    const r = canActOnTask(employee, "it_security", twin);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/IT security/);
  });

  it("HR has NO broad access to service-owner tasks", () => {
    const r = canActOnTask(hr, "it_security", twin);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no access to service-owner/);
    expect(canActOnTask(hr, "hr", twin).ok).toBe(true);
  });

  it("manager acts only on own direct reports", () => {
    expect(canActOnTask(manager, "manager", twin).ok).toBe(true);
    expect(canActOnTask({ ...manager, id: "other-mgr" }, "manager", twin).ok).toBe(false);
    expect(canActOnTask({ ...hr, id: "hr1" }, "employee", twin).ok).toBe(false);
  });

  it("IT service owner acts on it_security tasks only", () => {
    expect(canActOnTask(itActor, "it_security", twin).ok).toBe(true);
    expect(canActOnTask(itActor, "employee", twin).ok).toBe(false);
    expect(canActOnTask(itActor, "hr", twin).ok).toBe(false);
  });

  it("blocks cross-org access", () => {
    expect(canActOnTask({ ...itActor, org_id: "org2" }, "it_security", twin).ok).toBe(false);
  });
});

describe("completion gate", () => {
  const approved = "approved" as const;

  it("rejects completion on a pending plan", () => {
    const r = validateCompletion({ planStatus: "pending_approval", task: taskOf("learn_go"), actor: employee, twin, evidence: [{ kind: "note", label: "x", value: "v" }] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("plan_pending");
  });

  it("rejects unauthorized completion (wrong owner)", () => {
    const r = validateCompletion({ planStatus: approved, task: taskOf("access_sso"), actor: employee, twin, evidence: [{ kind: "note", label: "x", value: "v" }] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("forbidden");
  });

  it("rejects double submission", () => {
    const r = validateCompletion({ planStatus: approved, task: taskOf("learn_go", { state: "done", completion_record: done("learn_go") }), actor: employee, twin, evidence: [] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("double_submission");
  });

  it("rejects completion when prerequisites are not satisfied", () => {
    const blocked = taskOf("learn_go", { state: "blocked", blocked_reasons: ["team_intro"] });
    const r = validateCompletion({ planStatus: approved, task: blocked, actor: employee, twin, evidence: [{ kind: "note", label: "x", value: "v" }] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("unmet_prerequisite");
  });

  it("rejects a blocked task even when blocked_reasons is empty (DB-loaded rows)", () => {
    // blocked_reasons is derived, not stored; a row loaded from the DB has it
    // empty but state 'blocked'. The gate must reject on state alone.
    const blocked = taskOf("learn_go", { state: "blocked", blocked_reasons: [] });
    const r = validateCompletion({ planStatus: approved, task: blocked, actor: employee, twin, evidence: [{ kind: "note", label: "x", value: "v" }] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("unmet_prerequisite");
  });

  it("rejects completion while blocked", () => {
    const blocked = taskOf("access_sso", { state: "blocked", blockers: [{ id: "b", note: "delay", reported_by: "it1", at: NOW, status: "open" }], blocked_reasons: [] });
    const r = validateCompletion({ planStatus: approved, task: blocked, actor: itActor, twin, evidence: [{ kind: "note", label: "x", value: "v" }] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("blocked");
  });

  it("rejects missing evidence (including assessment evidence on verification)", () => {
    const r = validateCompletion({ planStatus: approved, task: taskOf("verify_go"), actor: employee, twin, evidence: [] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("missing_evidence");
  });

  it("rejects waived tasks", () => {
    const r = validateCompletion({ planStatus: approved, task: taskOf("learn_go", { state: "waived" }), actor: employee, twin, evidence: [] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("already_waived");
  });

  it("accepts a valid completion with evidence", () => {
    const r = validateCompletion({ planStatus: approved, task: taskOf("learn_go"), actor: employee, twin, evidence: [{ kind: "note", label: "Contribution evidence: Go", value: "PR #42 merged" }] });
    expect(r.ok).toBe(true);
  });

  it("accepts IT completing provisioning with evidence but not the employee", () => {
    const okIt = validateCompletion({ planStatus: approved, task: taskOf("it_provisioning"), actor: itActor, twin, evidence: [{ kind: "note", label: "Hardware & asset tag", value: "WS-ASSET-8842" }] });
    expect(okIt.ok).toBe(true);
    const noEmp = validateCompletion({ planStatus: approved, task: taskOf("it_provisioning"), actor: employee, twin, evidence: [{ kind: "note", label: "Hardware & asset tag", value: "self-claimed" }] });
    expect(noEmp.ok).toBe(false);
    expect(noEmp.code).toBe("forbidden");
  });
});

describe("waivers", () => {
  it("manager may waive a waivable employee-owned task with reason", () => {
    expect(canWaive(manager, twin, false, "employee").ok).toBe(true);
    expect(canWaive(employee, twin, false, "employee").ok).toBe(false); // employee cannot waive own
    expect(canWaive({ ...manager, id: "other" }, twin, false, "employee").ok).toBe(false); // not their direct report
  });

  it("non-waivable tasks require HR Executive + cannot be bypassed by a plain write", () => {
    expect(canWaive(hr, twin, true, "employee").ok).toBe(true);
    expect(canWaive(hrPartner, twin, true, "employee").ok).toBe(false);
    expect(canWaive(manager, twin, true, "employee").ok).toBe(false);
    expect(canWaive(itActor, twin, true, "it_security").ok).toBe(false);
  });

  it("applies a waiver and treats it as satisfied downstream", () => {
    const t = taskOf("learn_go");
    const waived = applyWaiver(t, { by_twin_id: "mgr1", by_name: "Mgr", reason: "Already proven", policy_basis: null, at: NOW });
    expect(waived.state).toBe("waived");
    expect(waived.waiver?.reason).toBe("Already proven");
  });
});

describe("adaptation", () => {
  it("replaces a learning task with a verification task and preserves reason+source", () => {
    const learning = DEFS.find((d) => d.task_code === "learn_go")!;
    const verify: TaskDef = { ...DEFS.find((d) => d.task_code === "verify_go")!, task_code: "verify_go_assessment", depends_on: ["team_intro"] };
    const { defs, adaptation } = adaptLearningToVerification(DEFS, learning, verify, {
      actor_twin_id: "mgr1",
      reason: "New assessment evidence covers Go mastery",
      source_evidence: [{ source_type: "assessment", fact: "Go work sample scored 0.9" }],
      at: NOW,
    });
    expect(adaptation.kind).toBe("replaced");
    expect(adaptation.replaced_by).toBe("verify_go_assessment");
    expect(adaptation.source_evidence[0].fact).toBe("Go work sample scored 0.9");
    expect(defs.find((d) => d.task_code === "learn_go")).toBeUndefined();
    expect(defs.find((d) => d.task_code === "verify_go_assessment")).toBeDefined();
  });

  it("failed verification reopens the gap and revises the plan", () => {
    const v = taskOf("verify_go");
    const { task, adaptation } = failVerification(v, {
      actor_twin_id: "mgr1",
      reason: "Assessment anchor not met; gap reopens",
      source_evidence: [{ source_type: "assessment", fact: "Scored below target anchor" }],
      at: NOW,
    });
    expect(task.state).toBe("failed");
    expect(adaptation.kind).toBe("reopened_gap");

    // Plan revision: builder re-adds a re-learning task when the skill is reopened.
    const revised = buildPlanDefs({
      role: { title: "Senior Backend Engineer", required_skills: [{ skill: "Go", target_proficiency: 4 }], future_skills: [], seniority_level: 4 },
      verified_skills: [{ name: "Go", proficiency: 4 }], // note: verified but verification failed — still reopened
      policy_docs: [{ doc_code: "POL-SEC", title: "Equipment & Security Policy" }],
      reopened_skills: ["Go"],
    });
    const reLearn = revised.find((d) => d.task_code === "learn_go_reopen");
    expect(reLearn).toBeDefined();
    expect(reLearn!.why_evidence.reason).toMatch(/re-opened/);
  });
});

describe("carryover on regeneration", () => {
  it("preserves completed work with a mapping only when the definition matches", () => {
    const prev = deriveStates(DEFS, { approved: true, startDate: START });
    const donePrev = materialize(prev, {
      completion: {
        it_provisioning: done("it_provisioning"),
        security_training: done("security_training"),
        payroll: done("payroll"),
      },
    });
    // Regenerate with a changed definition on one task.
    const newDefs = DEFS.map((d) => (d.task_code === "team_intro" ? { ...d, duration_days: 2 } : d));
    const { tasks, entries } = buildCarryover(donePrev, newDefs, "plan-old", 1);
    const byCode = new Map(tasks.map((t) => [t.task_code, t]));
    expect(byCode.get("it_provisioning")!.state).toBe("done");
    expect(byCode.get("payroll")!.state).toBe("done");
    // Changed def -> NOT carried (fresh pending).
    expect(byCode.get("team_intro")!.state).toBe("pending");
    expect(byCode.get("team_intro")!.completion_record).toBeNull();
    expect(entries.map((e) => e.task_code).sort()).toEqual(["it_provisioning", "payroll", "security_training"]);
    expect(entries[0].note).toMatch(/preserved/);
  });
});

describe("satisfiedSet", () => {
  it("counts done and waived as satisfied", () => {
    const s = satisfiedSet([
      { task_code: "a", state: "done" },
      { task_code: "b", state: "waived" },
      { task_code: "c", state: "blocked" },
    ]);
    expect(s.has("a")).toBe(true);
    expect(s.has("b")).toBe(true);
    expect(s.has("c")).toBe(false);
  });
});

describe("plan builder", () => {
  it("builds a deterministic plan from the approved role relationship", () => {
    const defs = buildPlanDefs({
      role: { title: "Senior Backend Engineer", required_skills: [{ skill: "Go", target_proficiency: 4 }, { skill: "PostgreSQL", target_proficiency: 3 }], future_skills: [{ skill: "Kubernetes", target_proficiency: 2 }], seniority_level: 4 },
      verified_skills: [{ name: "Go", proficiency: 3 }, { name: "Docker", proficiency: 2 }],
      policy_docs: [{ doc_code: "POL-SEC", title: "Equipment & Security Policy" }],
    });
    expect(planHash(defs)).toBe(planHash(defs));
    // Go gap (3<4) -> learning + verification; PostgreSQL gap -> learning only; Kubernetes future gap.
    expect(defs.find((d) => d.task_code === "learn_go")).toBeDefined();
    expect(defs.find((d) => d.task_code === "verify_go")).toBeDefined();
    expect(defs.find((d) => d.task_code === "learn_postgresql")).toBeDefined();
    expect(defs.find((d) => d.task_code === "future_kubernetes")).toBeDefined();
    // Approved role relationship drives the graph (no title substring anywhere).
    expect(defs.every((d) => !d.title.includes("Senior Backend Engineer"))).toBe(true);
  });

  it("waives nothing at build time — verified skills only skip the gap task", () => {
    const defs = buildPlanDefs({
      role: { title: "Data Analyst", required_skills: [{ skill: "SQL", target_proficiency: 4 }], future_skills: [], seniority_level: 3 },
      verified_skills: [{ name: "SQL", proficiency: 5 }],
      policy_docs: [],
    });
    expect(defs.find((d) => d.task_code === "learn_sql")).toBeUndefined();
    expect(defs.find((d) => d.task_code === "survey")!.depends_on).toEqual(["team_intro"]);
  });
});
