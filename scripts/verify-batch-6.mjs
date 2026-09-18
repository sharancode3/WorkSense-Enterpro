// Batch 6 verification (cross-module handoffs — no demo reset between steps):
// 6.2 reviewed assessment -> canonical skill_fits row -> hiring comparison
//     reflects the reviewed fit immediately.
// 6.3 authorized hiring handoff: select -> convert (same twin, role employee)
//     -> onboarding plan generated from the approved role with owned tasks.
// 6.4 onboarding handoff: generated plan exposes IT provisioning work.
// 6.7 idempotency: a second select on the same application version is rejected
//     (STALE_STATE) — no duplicate conversion.
// Ends with a pristine reset.
const URL = "https://spb-t4nma58f2hzmq798.supabase.opentrust.net";
const ANON =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5tYTU4ZjJoem1xNzk4IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk3MjQ1NDIsImV4cCI6MjEwNTMwMDU0Mn0.AKSYO90RFADUoLdCndEbqmJQRQDqUpAXukKxCIJLPAQ";
const PW = "WorkSenseDemo!2026";
const PRIYA = "22222222-2222-2222-2222-222222222205";
const DISPOSABLE = "22222222-2222-2222-2222-222222222299";
const PRIYA_WORK_SESSION = "77777777-7777-7777-7777-777777777701";
const REQ = "33333333-3333-3333-3333-333333333301";

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

// ---- 6.2 reviewed assessment -> canonical fit -> hiring comparison ----------
const priyaApps = await restGet(chris.token, `applications?select=id,stage,version&candidate_twin_id=eq.${PRIYA}&requisition_id=eq.${REQ}`);
const priyaApp = priyaApps?.[0];
check("setup: Priya's application on the backend-engine requisition", Boolean(priyaApp), `stage=${priyaApp?.stage}`);

// Compute a baseline durable fit (skill-match writes the canonical skill_fits row).
const baseline = await invoke(chris.token, "skill-match", { twin_id: PRIYA, target_id: REQ, scenario: "current", force: true });
check("setup: baseline fit computed (canonical skill_fits written)", baseline.status === 200 && typeof baseline.j?.fit?.score === "number", `score=${baseline.j?.fit?.score?.toFixed?.(3) ?? baseline.j?.fit?.score}`);

// Submit the work sample under its REAL question keys (q1/q2/q3), evaluate it
// (model), then review (human confirm) using the model's own validated quotes.
const sub = await invoke(chris.token, "assessment-session", {
  action: "submit",
  token: "ws-demo-priya-work-2026",
  answers: {
    q1: "I would make processing idempotent with an idempotency key stored under a unique constraint; duplicates arriving in parallel race on that constraint, and the loser returns the stored result. Retries use bounded backoff.",
    q2: "I would run EXPLAIN ANALYZE on the slow query, inspect the plan for a sequential scan, then propose a covering index and verify the fix against the same query shape in a staging copy.",
    q3: "I would use bounded retries with exponential backoff plus a circuit breaker; when the upstream degrades for minutes, I would stop retrying, serve stale or queued fallbacks, and alert on the breaker state.",
  },
});
check("setup: Priya work sample submitted", sub.status === 200 && sub.j?.ok === true, `status=${sub.status}`);
const ev = await invoke(chris.token, "assessment-evaluate", { session_id: PRIYA_WORK_SESSION });
check("setup: evaluation produced (or retryable)", ev.status === 200 || (ev.j?.job_id && ev.status >= 400 && ev.status < 600), `status=${ev.status} code=${ev.j?.error ?? "ok"}`);

const sessionFetch = await invoke(chris.token, "assessment-session", { action: "fetch", session_id: PRIYA_WORK_SESSION });
const evaluation = sessionFetch.j?.evaluation;
const assessmentId = evaluation?.assessment_id;
const rubricCompetencies = (sessionFetch.j?.rubrics ?? []).map((r) => r.competency);
const aiJudgments = evaluation?.ai?.judgments ?? [];
check("setup: evaluation available for review", Boolean(assessmentId && rubricCompetencies.length > 0), `assess=${assessmentId?.slice(0, 8)} comps=${rubricCompetencies.length}`);

if (assessmentId) {
  const reviewJudgments = rubricCompetencies.map((comp) => {
    const ai = aiJudgments.find((j) => String(j.competency ?? "").toLowerCase() === String(comp).toLowerCase());
    const judgment = ai?.judgment ?? "NOT_ASSESSED";
    const quotes = ["NOT_ASSESSED", "INSUFFICIENT_EVIDENCE"].includes(judgment) ? [] : (ai?.evidence_quotes ?? []).slice(0, 1);
    return { competency: comp, judgment, evidence_quotes: quotes, reason: undefined };
  });
  const review = await invoke(chris.token, "assessment-review", {
    assessment_id: assessmentId,
    determination: "confirm",
    judgments: reviewJudgments,
  });
  check("6.2 human review confirms the evaluation", review.status === 200 && review.j?.ok === true, `status=${review.status} written=${review.j?.evidence_written?.length}`);
  const reviewedFit = review.j?.fit?.current;
  check("6.2 review returns a recomputed fit", typeof reviewedFit === "number", `fit=${reviewedFit?.toFixed?.(3)}`);

  // Canonical skill_fits row for Priya + req + current must exist.
  const fits = await restGet(chris.token, `skill_fits?select=twin_id,target_id,scenario,fit,computed_at&twin_id=eq.${PRIYA}&target_id=eq.${REQ}&scenario=eq.current`);
  const canonical = fits?.[0];
  check("6.2 canonical skill_fits row refreshed by the review", Boolean(canonical && canonical.fit), `score=${canonical?.fit?.score?.toFixed?.(3) ?? "?"}`);

  // Hiring comparison must read the SAME reviewed score.
  const cmp = await invoke(chris.token, "candidate-compare", { req_id: REQ });
  const row = (cmp.j?.rows ?? []).find((r) => r.twin_id === PRIYA);
  const cmpScore = row?.score ?? null;
  const matches = cmpScore !== null && Math.abs(cmpScore - (canonical?.fit?.score ?? reviewedFit)) < 1e-6;
  check("6.2 hiring comparison reflects the reviewed fit (no demo reset)", matches, `compare=${cmpScore?.toFixed?.(3)} canonical=${canonical?.fit?.score?.toFixed?.(3)}`);
  check("6.2 reviewed evidence is source-linked (assessment_supported)", review.j?.evidence_written?.length >= 1, `written=${review.j?.evidence_written?.length}`);
}

// ---- 6.3 hiring handoff: advance -> select -> convert -> onboarding plan ----
const discApps = await restGet(chris.token, `applications?select=id,stage,version&candidate_twin_id=eq.${DISPOSABLE}`);
const discApp = discApps?.[0];
check("setup: disposable candidate has an application", Boolean(discApp), `stage=${discApp?.stage} v${discApp?.version}`);

// Selection is only legal from the final round (stage engine). Advance twice.
const m1 = await invoke(chris.token, "application-stage", {
  application_id: discApp.id,
  decision: "move_forward",
  expected_stage: discApp.stage,
  expected_version: discApp.version,
  reason: "Advanced to technical interview.",
});
const m2 = await invoke(chris.token, "application-stage", {
  application_id: discApp.id,
  decision: "move_forward",
  expected_stage: m1.j?.application?.stage,
  expected_version: m1.j?.application?.version,
  reason: "Advanced to final round.",
});
check("setup: disposable candidate advanced to final round", m2.status === 200 && m2.j?.application?.stage === "final_round", `status=${m2.status} stage=${m2.j?.application?.stage}`);

const select1 = await invoke(chris.token, "application-stage", {
  application_id: discApp.id,
  decision: "select",
  expected_stage: m2.j?.application?.stage,
  expected_version: m2.j?.application?.version,
  reason: "Selected for demo acceptance run.",
});
check("6.3 select converts the candidate (hiring transition)", select1.status === 200 && select1.j?.conversion?.status === "converted" && select1.j?.application?.stage === "selected", `status=${select1.status} stage=${select1.j?.application?.stage}`);

// No duplicate profile: the SAME twin id is now an employee (HR scope — a
// recruiter's RLS correctly hides employee twins, which itself is a scope pass).
const convTwin = await restGet(dana.token, `digital_twins?select=id,role,status,job_title&id=eq.${DISPOSABLE}`);
check("6.3 conversion reuses the same twin (no duplicate profile)", convTwin?.[0]?.role === "employee" && convTwin?.[0]?.status === "active", `role=${convTwin?.[0]?.role}`);

// 6.7 idempotency: repeating select against the OLD version is rejected.
const select2 = await invoke(chris.token, "application-stage", {
  application_id: discApp.id,
  decision: "select",
  expected_stage: m2.j?.application?.stage,
  expected_version: m2.j?.application?.version,
  reason: "Duplicate select attempt.",
});
check("6.7 duplicate select rejected (STALE_STATE, version guard)", select2.status === 409 && select2.j?.error === "STALE_STATE", `status=${select2.status} err=${select2.j?.error}`);

// Onboarding handoff: HR generates the plan from the approved role.
const plan = await invoke(dana.token, "onboarding-plan", { twin_id: DISPOSABLE });
check("6.3 onboarding plan generated from the approved role", plan.status === 200 && Boolean(plan.j?.plan?.id), `status=${plan.status} plan=${plan.j?.plan?.id?.slice(0, 8)}`);
const planId = plan.j?.plan?.id;
if (planId) {
  const tasks = await restGet(dana.token, `onboarding_tasks?select=task_code,owner_role,state&plan_id=eq.${planId}`);
  const codes = (tasks ?? []).map((t) => t.task_code);
  check("6.4 generated plan exposes IT provisioning work (hiring handoff)", codes.includes("it_provisioning") || codes.includes("access_sso"), `tasks=${codes.slice(0, 6).join(",")}`);
  check("6.4 plan tasks have role owners (employee/manager/IT)", (tasks ?? []).some((t) => ["employee", "manager", "it_security"].includes(t.owner_role)), `owners=${[...new Set((tasks ?? []).map((t) => t.owner_role))].join(",")}`);
}

// ---- pristine reset ----------------------------------------------------------
await invoke(dana.token, "reset-demo", {});
const back = await restGet(chris.token, `digital_twins?select=role&id=eq.${DISPOSABLE}`);
check("teardown: reset restores the disposable candidate role", back?.[0]?.role === "candidate", `role=${back?.[0]?.role}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\nBatch 6: ${results.length - failed}/${results.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);
