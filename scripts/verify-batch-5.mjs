// Batch 5 verification (interview/assessment discoverability):
// 5.2 hiring work queue — six queues, org-scoped, linked to candidate/role;
// 5.1 candidate sessions render from real rows (3 for Priya);
// 5.3 reads are never silently empty (queue + REST return rows or errors);
// 5.6 seeded interview record present;
// 5.7 duplicate submission rejected server-side (DUPLICATE_SUBMISSION);
// role gating (manager -> 403). Ends with a pristine reset.
const URL = "https://spb-t4nma58f2hzmq798.supabase.opentrust.net";
const ANON =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5tYTU4ZjJoem1xNzk4IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk3MjQ1NDIsImV4cCI6MjEwNTMwMDU0Mn0.AKSYO90RFADUoLdCndEbqmJQRQDqUpAXukKxCIJLPAQ";
const PW = "WorkSenseDemo!2026";
const PRIYA = "22222222-2222-2222-2222-222222222205";
const PRIYA_WORK_SESSION = "77777777-7777-7777-7777-777777777701";

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
const chris = await signin("chris@worksense.demo");
const jordan = await signin("jordan@worksense.demo");

// ---- 5.2 hiring work queue (org-scoped, linked, gated) --------------------
const q1 = await invoke(chris.token, "assessment-queue", {});
check("5.2 recruiter can read the hiring work queue", q1.status === 200 && q1.j?.ok === true, `status=${q1.status} role=${q1.j?.role}`);
check("5.2 queue exposes all six queues", q1.j?.queues && ["upcoming_interviews", "invitations_awaiting_response", "incomplete_scorecards", "submitted_assessments", "awaiting_reviewer_confirmation", "failed_evaluation_jobs"].every((k) => Array.isArray(q1.j.queues[k])), `keys=${Object.keys(q1.j?.queues ?? {}).length}`);

// Seeded demo: 6 invited sessions (3 Priya + 3 disposable).
const invitedCount = q1.j?.queues?.invitations_awaiting_response?.length ?? -1;
check("5.2 invitations awaiting = the 6 seeded invited sessions (no fabrication)", invitedCount === 6, `count=${invitedCount}`);

const upcoming = q1.j?.queues?.upcoming_interviews ?? [];
// Batch 7 fixture: Ravi's in-progress interview joins Priya + disposable
// invited interviews -> 3 upcoming interviews, all interview sessions.
check("5.2 upcoming interviews are only interview sessions", upcoming.length === 3 && upcoming.every((s) => s.session_type === "interview"), `count=${upcoming.length}`);
const priyaInterview = upcoming.find((s) => s.candidate?.id === PRIYA);
check("5.2 queue item links candidate + application + role", Boolean(priyaInterview && priyaInterview.role.title && priyaInterview.role.application_code && priyaInterview.role.application_id), `title=${priyaInterview?.role?.title} app=${priyaInterview?.role?.application_code}`);

// 5.1/5.3 real rows: Priya's application has 3 sessions the tab renders.
const priyaApps = await restGet(chris.token, `applications?select=id&candidate_twin_id=eq.${PRIYA}`);
const priyaApp = priyaApps?.[0];
check("setup: Priya has an application", Boolean(priyaApp), `id=${priyaApp?.id}`);
const priyaSessions = await restGet(chris.token, `candidate_sessions?select=id,session_type,status&application_id=eq.${priyaApp.id}&order=created_at`);
check("5.1 candidate workspace has 3 real session rows (3 formats)", priyaSessions?.length === 3 && new Set(priyaSessions.map((s) => s.session_type)).size === 3, `count=${priyaSessions?.length} types=${[...new Set((priyaSessions ?? []).map((s) => s.session_type))].join(",")}`);

// 5.2 role gate: manager cannot read the hiring queue.
const mgrQ = await invoke(jordan.token, "assessment-queue", {});
check("5.2 manager is rejected from the hiring queue (role gate)", mgrQ.status === 403 && mgrQ.j?.error === "FORBIDDEN", `status=${mgrQ.status}`);

// ---- 5.7 candidate-session reliability: duplicate submission rejected ------
const sub1 = await invoke(chris.token, "assessment-session", {
  action: "submit",
  token: "ws-demo-priya-work-2026",
  answers: { scenario_design: "I would build the payments service with idempotent webhook handling." },
});
check("5.7 first submission accepted", sub1.status === 200 && sub1.j?.ok === true, `status=${sub1.status}`);
const sub2 = await invoke(chris.token, "assessment-session", {
  action: "submit",
  token: "ws-demo-priya-work-2026",
  answers: { scenario_design: "I would build the payments service with idempotent webhook handling." },
});
check("5.7 identical duplicate submission rejected (DUPLICATE_SUBMISSION)", sub2.status === 409 && sub2.j?.error === "DUPLICATE_SUBMISSION", `status=${sub2.status} err=${sub2.j?.error}`);

// ---- 5.2 submitted assessment now shows as an incomplete scorecard ---------
const q2 = await invoke(chris.token, "assessment-queue", {});
const incomplete = q2.j?.queues?.incomplete_scorecards ?? [];
const submittedList = q2.j?.queues?.submitted_assessments ?? [];
check("5.2 submitted-but-unscored session appears under incomplete scorecards", incomplete.some((s) => s.session_id === PRIYA_WORK_SESSION), `count=${incomplete.length}`);
check("5.2 submitted session appears under submitted assessments", submittedList.some((s) => s.session_id === PRIYA_WORK_SESSION), `count=${submittedList.length}`);

// ---- evaluation -> awaiting review OR failed job (both linked) -------------
await invoke(chris.token, "assessment-evaluate", { session_id: PRIYA_WORK_SESSION }).catch(() => null);
const q3 = await invoke(chris.token, "assessment-queue", {});
const awaitingReview = q3.j?.queues?.awaiting_reviewer_confirmation ?? [];
const failedJobs = q3.j?.queues?.failed_evaluation_jobs ?? [];
const inAwaiting = awaitingReview.some((a) => a.session_id === PRIYA_WORK_SESSION);
const inFailed = failedJobs.some((f) => f.session?.session_id === PRIYA_WORK_SESSION);
check("5.2 evaluation lands as awaiting-review (or failed job) linked to the session", inAwaiting || inFailed, `awaiting=${awaitingReview.length} failed=${failedJobs.length}`);
if (inAwaiting) {
  const row = awaitingReview.find((a) => a.session_id === PRIYA_WORK_SESSION);
  check("5.2 awaiting-review row carries candidate + role linkage", Boolean(row && row.candidate.id && row.role.title), `candidate=${row?.candidate?.name}`);
}

// ---- pristine reset ----------------------------------------------------------
await invoke(dana.token, "reset-demo", {});
const q4 = await invoke(chris.token, "assessment-queue", {});
check("teardown: reset restores the seeded 6 invited sessions", (q4.j?.queues?.invitations_awaiting_response?.length ?? -1) === 6, `count=${q4.j?.queues?.invitations_awaiting_response?.length}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\nBatch 5: ${results.length - failed}/${results.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);
