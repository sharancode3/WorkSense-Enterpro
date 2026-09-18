// Batch 10 verification (staffing proposal human-review loop):
// - manager plans + submits a proposal (open, bound to option + version)
// - HR reviewer approves with a note -> durable decision (status, reviewer,
//   timestamp), idempotent re-review rejected (409 ALREADY_REVIEWED)
// - approved option resolving to an employee dispatches ONE owned follow-up
//   task (idempotency key staffing-proposal:<id>); declined creates none
// - manager list is team-scoped (never sees HR's proposals)
// - hr_partner is also a reviewer
// Ends with a pristine reset.
const URL = "https://spb-t4nma58f2hzmq798.supabase.opentrust.net";
const ANON =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5tYTU4ZjJoem1xNzk4IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk3MjQ1NDIsImV4cCI6MjEwNTMwMDU0Mn0.AKSYO90RFADUoLdCndEbqmJQRQDqUpAXukKxCIJLPAQ";
const PW = "WorkSenseDemo!2026";

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
const jordan = await signin("jordan@worksense.demo");
const riley = await signin("riley@worksense.demo");
await invoke(dana.token, "reset-demo", {});

// ---- manager plans a scenario and submits a proposal ------------------------
const PLAN_INPUT = {
  action: "plan",
  name: "Batch 10 review-loop scenario",
  demand_title: "Senior Backend Engineer",
  deadline_days: 42,
  budget_usd: 60000,
  capacity_people: 1,
  geography: "US",
  horizon_months: 12,
  required_skills: [
    { skill: "Go", min_proficiency: 3, mandatory: true },
    { skill: "REST APIs", min_proficiency: 3, mandatory: true },
  ],
};
const plan = await invoke(jordan.token, "staffing-comparison", PLAN_INPUT);
check("setup: manager plans a scenario", plan.status === 200 && Boolean(plan.j?.scenario_id), `scenario=${plan.j?.scenario_id?.slice?.(0, 8)}`);
const options = (plan.j?.options ?? []).filter((o) => ["feasible", "conditional"].includes(o.status));
const moveOpt = options.find((o) => String(o.label ?? "").toLowerCase().includes("move")) ?? options.find((o) => o.subject) ?? options[0];
check("setup: plan exposes a subject-bearing option", Boolean(moveOpt?.subject), `label=${moveOpt?.label} subject=${moveOpt?.subject}`);

const p1 = await invoke(jordan.token, "staffing-comparison", { action: "propose", scenario_id: plan.j.scenario_id, option_id: moveOpt.id });
const P1 = p1.j?.proposal_id;
check("10 manager submits proposal (open)", p1.status === 200 && p1.j?.status === "open" && Boolean(P1), `status=${p1.j?.status} id=${P1?.slice?.(0, 8)}`);

// ---- HR reviewer approves with a note ----------------------------------------
const approve = await invoke(dana.token, "staffing-comparison", {
  action: "review_proposal",
  proposal_id: P1,
  decision: "approved",
  review_note: "Verified coverage clears the mandatory gate — approve the move.",
});
check("10 HR approves proposal (durable decision)", approve.status === 200 && approve.j?.proposal?.status === "approved", `status=${approve.j?.proposal?.status}`);
check("10 approval persists reviewer + note + timestamp", Boolean(approve.j?.proposal?.reviewed_by) && Boolean(approve.j?.proposal?.reviewed_at) && String(approve.j?.proposal?.review_note ?? "").includes("mandatory gate"), `by=${approve.j?.proposal?.reviewed_by?.slice?.(0, 8)} at=${approve.j?.proposal?.reviewed_at ? "set" : "missing"}`);

const reReview = await invoke(dana.token, "staffing-comparison", { action: "review_proposal", proposal_id: P1, decision: "declined", review_note: "late change" });
check("10 re-review rejected (idempotent, ALREADY_REVIEWED)", reReview.status === 409 && reReview.j?.error === "ALREADY_REVIEWED", `status=${reReview.status} err=${reReview.j?.error}`);

const bogus = await invoke(dana.token, "staffing-comparison", { action: "review_proposal", proposal_id: "00000000-0000-0000-0000-000000000000", decision: "approved" });
check("10 unknown proposal -> 404", bogus.status === 404 && bogus.j?.error === "NOT_FOUND", `status=${bogus.status}`);

const managerReview = await invoke(jordan.token, "staffing-comparison", { action: "review_proposal", proposal_id: P1, decision: "approved" });
check("10 manager cannot review (403 role gate)", managerReview.status === 403 && managerReview.j?.error === "FORBIDDEN", `status=${managerReview.status}`);

// ---- approval dispatched an owned follow-up task for the subject ---------------
const subjectRow = await restGet(dana.token, `digital_twins?select=id,name&name=eq.${encodeURIComponent(moveOpt.subject)}&status=eq.active`);
const subjectId = subjectRow?.[0]?.id;
check("10 subject twin resolves in org", Boolean(subjectId), `name=${moveOpt.subject}`);
const tasks = await restGet(dana.token, `action_tasks?select=id,owner_twin_id,owner_role,title,status,created_by_request_id&created_by_request_id=eq.${encodeURIComponent("staffing-proposal:" + P1)}`);
const task = tasks?.[0];
check("10 approved proposal dispatches one owned task", task?.owner_twin_id === subjectId && task?.owner_role === "employee" && task?.status === "open", `owner=${task?.owner_twin_id === subjectId ? "subject" : task?.owner_twin_id} role=${task?.owner_role}`);
check("10 follow-up task is titled from the approved option", String(task?.title ?? "").includes(String(moveOpt.label ?? "").slice(0, 24)), `title=${task?.title?.slice?.(0, 60)}`);

// ---- declined proposal creates no task ----------------------------------------
const p2Opt = options.find((o) => o.id !== moveOpt.id) ?? moveOpt;
const p2 = await invoke(jordan.token, "staffing-comparison", { action: "propose", scenario_id: plan.j.scenario_id, option_id: p2Opt.id });
const P2 = p2.j?.proposal_id;
const decline = await invoke(dana.token, "staffing-comparison", { action: "review_proposal", proposal_id: P2, decision: "declined", review_note: "Budget overrun for this option." });
check("10 HR declines second proposal", decline.status === 200 && decline.j?.proposal?.status === "declined", `status=${decline.j?.proposal?.status}`);
const tasksP2 = await restGet(dana.token, `action_tasks?select=id&created_by_request_id=eq.${encodeURIComponent("staffing-proposal:" + P2)}`);
check("10 declined proposal dispatches no task", (tasksP2 ?? []).length === 0, `rows=${(tasksP2 ?? []).length}`);

// ---- hr_partner is also a reviewer; manager list is team-scoped ---------------
const rileyPlan = await invoke(riley.token, "staffing-comparison", PLAN_INPUT);
const rileyOpt = (rileyPlan.j?.options ?? []).find((o) => ["feasible", "conditional"].includes(o.status));
const p3 = await invoke(riley.token, "staffing-comparison", { action: "propose", scenario_id: rileyPlan.j.scenario_id, option_id: rileyOpt.id });
const P3 = p3.j?.proposal_id;
const rileyReview = await invoke(riley.token, "staffing-comparison", { action: "review_proposal", proposal_id: P3, decision: "approved" });
check("10 hr_partner reviews and approves", rileyReview.status === 200 && rileyReview.j?.proposal?.status === "approved", `status=${rileyReview.j?.proposal?.status}`);

const danaList = await invoke(dana.token, "staffing-comparison", { action: "list" });
const jordanList = await invoke(jordan.token, "staffing-comparison", { action: "list" });
check("10 HR list sees all org proposals", (danaList.j?.proposals ?? []).length === 3, `rows=${(danaList.j?.proposals ?? []).length}`);
check("10 HR list resolves submitted-by name", danaList.j?.proposals.some((p) => p.submitted_by_name === "Jordan Reyes"), `names=${danaList.j?.proposals.map((p) => p.submitted_by_name ?? "?").join(",")}`);
check("10 manager list is team-scoped (never HR's proposal)", (jordanList.j?.proposals ?? []).length === 2 && !(jordanList.j?.proposals ?? []).some((p) => p.id === P3), `rows=${(jordanList.j?.proposals ?? []).length}`);

// ---- teardown: reset clears proposals + follow-up tasks ------------------------
await invoke(dana.token, "reset-demo", {});
const after = await invoke(dana.token, "staffing-comparison", { action: "list" });
check("teardown: reset restores pristine proposal state", (after.j?.proposals ?? []).length === 0, `rows=${(after.j?.proposals ?? []).length}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\nBatch 10: ${results.length - failed}/${results.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);
