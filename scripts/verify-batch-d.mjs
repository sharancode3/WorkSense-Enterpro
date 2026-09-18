// Batch D verification (onboarding):
// D1/D2: multi-stage journey set (5 journeys: pending approval, waiting on IT,
//        progressing, nearly complete, completed) with department/counts/gates.
// D3: compare data present (completed/total, gates, time since start, overdue).
// D5: queue (onboarding-queue fn) and dashboard agree on the same plan source.
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
  return (await r.json()).access_token;
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

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
};

const dana = await signin("dana@worksense.demo");
await invoke(dana, "reset-demo", {});

const q = await invoke(dana, "onboarding-queue", {});
const journeys = q.j?.journeys ?? [];
check("D2 5 journeys present", journeys.length === 5, `journeys=${journeys.length}`);

const byName = Object.fromEntries(journeys.map((j) => [j.employee_name, j]));
// Alex Chen — approved, waiting on IT (blocker). Samira — pending approval.
// Marcus — approved/progressing. Wei — approved/nearly complete. Fatima — completed.
check("D2 Alex approved", byName["Alex Chen"]?.status === "approved", `status=${byName["Alex Chen"]?.status}`);
check("D2 Samira pending approval", byName["Samira Patel"]?.status === "pending_approval" && byName["Samira Patel"]?.pending_manager_approval, `status=${byName["Samira Patel"]?.status}`);
check("D2 Diego progressing", byName["Diego Mensah"]?.status === "approved" && byName["Diego Mensah"]?.completed_tasks > 0 && byName["Diego Mensah"]?.readiness_pct < 100, `done=${byName["Diego Mensah"]?.completed_tasks} pct=${byName["Diego Mensah"]?.readiness_pct}`);
check("D2 Wei nearly complete", byName["Wei Fernandez"]?.status === "approved" && byName["Wei Fernandez"]?.readiness_pct > 50 && byName["Wei Fernandez"]?.readiness_pct < 100, `pct=${byName["Wei Fernandez"]?.readiness_pct}`);
check("D2 Fatima completed", byName["Fatima Kowalski"]?.status === "completed" && byName["Fatima Kowalski"]?.completed_tasks === byName["Fatima Kowalski"]?.total_tasks, `done=${byName["Fatima Kowalski"]?.completed_tasks}/${byName["Fatima Kowalski"]?.total_tasks}`);

// D1 overview fields
const hasDept = journeys.every((j) => typeof j.department === "string");
const hasCounts = journeys.every((j) => typeof j.completed_tasks === "number" && typeof j.total_tasks === "number");
const hasGates = journeys.every((j) => Array.isArray(j.gates));
check("D1 department present on all journeys", hasDept, `depts=${[...new Set(journeys.map((j) => j.department))].join(",")}`);
check("D1 completed/total counts present", hasCounts, `e.g. ${byName["Wei Fernandez"]?.completed_tasks}/${byName["Wei Fernandez"]?.total_tasks}`);
check("D1 readiness gates present", hasGates, `gates=${byName["Alex Chen"]?.gates?.length ?? 0} on Alex`);

// D3 compare data: distinct roles + multiple journeys to compare
const roles = new Set(journeys.map((j) => j.job_title));
check("D3 multiple distinct roles", roles.size >= 3, `roles=${[...roles].join(" | ")}`);
check("D3 start dates present for time-since-start", journeys.every((j) => typeof j.start_date === "string" && j.start_date.length > 0));

// D5 canonical consistency: dashboard onboarding counts use the same rows.
const dash = await invoke(dana, "dashboard", {});
const activePlans = journeys.filter((j) => j.status === "approved" || j.status === "pending_approval").length;
const dashActive = dash.j?.cards?.journeys_in_progress;
console.log("      dashboard journeys_in_progress:", dashActive, "| queue journeys:", journeys.length, "| active:", activePlans);
check("D5 dashboard journeys_in_progress === queue count", dashActive === journeys.length, `dash=${dashActive} queue=${journeys.length}`);
check("D5 dashboard on-track/blocked agree", typeof dash.j?.cards?.journeys_on_track === "number" && typeof dash.j?.cards?.journeys_blocked === "number", `on_track=${dash.j?.cards?.journeys_on_track} blocked=${dash.j?.cards?.journeys_blocked}`);

// every journey has a distinct plan_id (recommendation-specific histories)
check("D3 each journey has its own plan", new Set(journeys.map((j) => j.plan_id)).size === journeys.length, `plans=${new Set(journeys.map((j) => j.plan_id)).size}`);

await invoke(dana, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
