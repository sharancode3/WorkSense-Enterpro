// Batch 4 verification (real onboarding handoff):
// 4.5 fixture: Diego's access_sso derives to READY (access-ready starter).
// 4.2/4.3 handoff: Elena (IT) completes Alex's laptop task with evidence,
// resolves the SSO blocker, completes SSO — then verifies the canonical task
// states cascade (team_intro becomes ready) and all views (IT queue, HR
// journey readiness) reflect the same canonical rows. IT still cannot read
// unrelated evidence. Ends with a pristine reset.
const URL = "https://spb-t4nma58f2hzmq798.supabase.opentrust.net";
const ANON =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5tYTU4ZjJoem1xNzk4IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk3MjQ1NDIsImV4cCI6MjEwNTMwMDU0Mn0.AKSYO90RFADUoLdCndEbqmJQRQDqUpAXukKxCIJLPAQ";
const PW = "WorkSenseDemo!2026";
const ALEX = "22222222-2222-2222-2222-222222222203";
const DIEGO = "6786033d-78a9-41ab-af1f-2f1982e02f1d";

const signin = async (email) => {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  return { token: j.access_token, email: j.user?.email ?? email };
};
const invoke = async (t, fn, b) => {
  const r = await fetch(`${URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(b ?? {}),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text: text.slice(0, 300) };
};
const restGet = async (t, path) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${t}` } });
  return r.ok ? await r.json() : null;
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
};

const dana = await signin("dana@worksense.demo");
await invoke(dana.token, "reset-demo", {});
const elena = await signin("elena@worksense.demo");
const riley = await signin("riley@worksense.demo");

// ---- 4.5 fixture: Diego's access_sso is READY ------------------------------
const diegoPlans = await restGet(dana.token, `onboarding_plans?select=id,twin_id,status&twin_id=eq.${DIEGO}&status=eq.approved`);
const diegoPlan = diegoPlans[0];
const diegoTasks = await restGet(elena.token, `onboarding_tasks?select=task_code,state&plan_id=eq.${diegoPlan.id}`);
const diegoAccess = diegoTasks.find((t) => t.task_code === "access_sso");
check("4.5 fixture: Diego's access_sso is READY (access-ready starter)", diegoAccess?.state === "ready", `state=${diegoAccess?.state}`);

// ---- 4.2/4.3 handoff on Alex ------------------------------------------------
const alexPlans = await restGet(dana.token, `onboarding_plans?select=id,twin_id,status,readiness&twin_id=eq.${ALEX}&status=eq.approved`);
const alexPlan = alexPlans[0];
const tasks0 = await restGet(elena.token, `onboarding_tasks?select=task_code,state,due_date,blockers,depends_on,evidence_requirements&plan_id=eq.${alexPlan.id}`);
const read = (code) => tasks0.find((t) => t.task_code === code);
check("setup: Alex laptop ready + SSO blocked", read("it_provisioning")?.state === "ready" && read("access_sso")?.state === "blocked", `laptop=${read("it_provisioning")?.state} sso=${read("access_sso")?.state}`);

const laptopDone = await invoke(elena.token, "onboarding-task", {
  plan_id: alexPlan.id,
  task_code: "it_provisioning",
  action: "complete",
  evidence: [{ kind: "note", label: "Hardware & asset tag", value: "LAPTOP-DEMO-IT-0042" }],
  note: "Laptop shipped with asset tag LAPTOP-DEMO-IT-0042.",
});
check("4.2 IT completes laptop with device-reference evidence", laptopDone.status === 200 && laptopDone.j?.state === "done", `status=${laptopDone.status} state=${laptopDone.j?.state}`);
check("4.2 plan readiness recomputed server-side", laptopDone.j?.readiness && typeof laptopDone.j.readiness.ready_pct === "number", `ready_pct=${laptopDone.j?.readiness?.ready_pct}`);

// SSO still gated by the open blocker — resolve it (IT owns the task).
const ssoAfterLaptop = await restGet(elena.token, `onboarding_tasks?select=task_code,state,blockers,depends_on&plan_id=eq.${alexPlan.id}&task_code=eq.access_sso`);
const ssoBlockerId = ssoAfterLaptop[0].blockers?.[0]?.id;
check("4.3 SSO stays blocked by the open blocker after laptop (deps only)", ssoAfterLaptop[0].state === "blocked" && Boolean(ssoBlockerId), `state=${ssoAfterLaptop[0].state}`);

const ssoResolve = await invoke(elena.token, "onboarding-task", { plan_id: alexPlan.id, task_code: "access_sso", action: "resolve", blocker_id: ssoBlockerId, note: "Ticket PROV-88 closed — assets delivered." });
check("4.3 blocker resolution is separate from completion (still actionable)", ssoResolve.status === 200 && ssoResolve.j?.state === "ready", `status=${ssoResolve.status} state=${ssoResolve.j?.state}`);

const ssoDone = await invoke(elena.token, "onboarding-task", {
  plan_id: alexPlan.id,
  task_code: "access_sso",
  action: "complete",
  evidence: [{ kind: "note", label: "MFA / SSO enrollment reference", value: "SSO-ENROLL-ALX-77" }],
  note: "MFA + SSO enrollment confirmed.",
});
check("4.3 IT completes SSO with access-confirmation evidence", ssoDone.status === 200 && ssoDone.j?.state === "done", `status=${ssoDone.status} state=${ssoDone.j?.state}`);

// Propagation: team_intro (manager-owned) now unblocks to ready.
const ssoBlockedPrev = read("access_sso").blockers ?? [];
check("4.4 ownership is role-based (IT actor authorized, no person claim)", ssoDone.j?.completion?.actor_twin_id === "22222222-2222-2222-2222-222222222210", `actor=${ssoDone.j?.completion?.actor_twin_id?.slice(-3)}`);
const cascade = await restGet(elena.token, `onboarding_tasks?select=task_code,state&plan_id=eq.${alexPlan.id}&task_code=eq.team_intro`);
check("4.3 SSO completion unblocks the manager orientation task (cascade)", cascade[0]?.state === "ready", `team_intro=${cascade[0]?.state}`);
void ssoBlockedPrev;

// Views reflect the same canonical rows: IT queue no longer lists Alex's work;
// HR journey readiness is updated.
const itQueue = await invoke(elena.token, "onboarding-queue", {});
const alexStillActionable = itQueue.j?.provisioning?.some((p) => p.twin_id === ALEX && (p.task_code === "it_provisioning" || p.task_code === "access_sso"));
check("4.3 IT queue reflects the handoff (Alex's tasks no longer actionable)", !alexStillActionable, `remaining=${itQueue.j?.provisioning?.filter((p) => p.twin_id === ALEX).length}`);
const hrQueue = await invoke(riley.token, "onboarding-queue", {});
const alexJourney = hrQueue.j?.journeys?.find((j) => j.twin_id === ALEX);
check("4.3 HR journey view recomputed (same canonical plan)", Boolean(alexJourney) && alexJourney.completed_tasks >= 3, `completed=${alexJourney?.completed_tasks} readiness=${alexJourney?.readiness_pct}`);

// IT cannot see unrelated evidence.
const itEvidence = await restGet(elena.token, "evidence_items?select=id&limit=5");
check("4.4 IT cannot see unrelated HR evidence", itEvidence.length === 0, `rows=${itEvidence.length}`);

await invoke(dana.token, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
