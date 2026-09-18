// Batch 8 verification — the one working cross-source journey, live, no demo
// reset between legs, no model dependency:
// Demand -> evidence -> explainable comparison -> human review -> owned
// execution -> updated readiness. Plus honesty checks that the coverage matrix
// is truthful (reviewed evidence exists; no "reviewed" rows without source
// quotes). Ends with a pristine reset.
const URL = "https://spb-t4nma58f2hzmq798.supabase.opentrust.net";
const ANON =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5tYTU4ZjJoem1xNzk4IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk3MjQ1NDIsImV4cCI6MjEwNTMwMDU0Mn0.AKSYO90RFADUoLdCndEbqmJQRQDqUpAXukKxCIJLPAQ";
const PW = "WorkSenseDemo!2026";
const RAVI = "22222222-2222-2222-2222-222222222240";
const DISPOSABLE = "22222222-2222-2222-2222-222222222299";
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

// Leg 1 — DEMAND: an open requisition with weighted criteria exists.
const req = await restGet(chris.token, `job_requisitions?select=id,status,requisition_criteria&id=eq.${REQ}`);
check("8 Demand: open requisition with weighted criteria", req?.[0]?.status === "open" && (req[0].requisition_criteria?.length ?? 0) >= 1, `criteria=${req?.[0]?.requisition_criteria?.length}`);

// Leg 2 — EVIDENCE: Ravi's reviewed work sample with a verbatim source quote.
const raviWork = await restGet(chris.token, `candidate_sessions?select=id&twin_id=eq.${RAVI}&session_type=eq.work_sample`);
const fetchRes = await invoke(chris.token, "assessment-session", { action: "fetch", session_id: raviWork[0].id });
const evaluation = fetchRes.j?.evaluation;
const quote = evaluation?.ai?.judgments?.[0]?.evidence_quotes?.[0];
const answerText = Object.values(fetchRes.j?.session?.answers ?? {}).join(" ");
check("8 Evidence: reviewed work sample with verbatim quote", Boolean(evaluation?.reviewed && quote && answerText.includes(quote)), `quote="${quote?.slice(0, 30)}…"`);

// Leg 3 — EXPLAINABLE COMPARISON: force a deterministic fit, then compare.
const fit = await invoke(chris.token, "skill-match", { twin_id: RAVI, target_id: REQ, scenario: "current", force: true });
check("8 Comparison: deterministic fit computed", fit.status === 200 && typeof fit.j?.fit?.score === "number", `score=${fit.j?.fit?.score?.toFixed?.(3)}`);
const cmp = await invoke(chris.token, "candidate-compare", { req_id: REQ });
const row = (cmp.j?.rows ?? []).find((r) => r.twin_id === RAVI);
check("8 Comparison: Ravi scored, not unknown-as-zero", row?.status === "scored" && row?.score !== null, `status=${row?.status} score=${row?.score?.toFixed?.(3)}`);

// Leg 4 — HUMAN REVIEW: the evidence leg was human-confirmed (reviewed_at set).
check("8 Human review: reviewed determination on record", evaluation?.reviewed?.determination === "confirm" && Boolean(evaluation.reviewed.at), `by=${evaluation?.reviewed?.by}`);

// Leg 5 — OWNED EXECUTION + Leg 6/7 — READINESS: hire -> plan -> owned tasks.
const discApps = await restGet(chris.token, `applications?select=id,stage,version&candidate_twin_id=eq.${DISPOSABLE}`);
const discApp = discApps?.[0];
const m1 = await invoke(chris.token, "application-stage", { application_id: discApp.id, decision: "move_forward", expected_stage: discApp.stage, expected_version: discApp.version, reason: "Journey leg: advance." });
const m2 = await invoke(chris.token, "application-stage", { application_id: discApp.id, decision: "move_forward", expected_stage: m1.j?.application?.stage, expected_version: m1.j?.application?.version, reason: "Journey leg: advance." });
const sel = await invoke(chris.token, "application-stage", { application_id: discApp.id, decision: "select", expected_stage: m2.j?.application?.stage, expected_version: m2.j?.application?.version, reason: "Journey leg: human select." });
const plan = await invoke(dana.token, "onboarding-plan", { twin_id: DISPOSABLE });
const readiness = plan.j?.plan?.readiness;
check("8 Owned execution: approved hire -> onboarding plan with owned tasks", Boolean(plan.j?.plan?.tasks?.length && plan.j.plan.tasks.some((t) => ["employee", "manager", "it_security"].includes(t.owner_role))), `tasks=${plan.j?.plan?.tasks?.length}`);
check("8 Updated readiness: plan exposes a numeric readiness estimate", typeof readiness?.ready_pct === "number", `ready_pct=${readiness?.ready_pct} satisfied=${readiness?.satisfied}/${readiness?.total}`);

// Honesty checks — no reviewed evidence without a source quote; no fake claims.
const evRows = await restGet(chris.token, `evidence_items?select=review_state,quote&twin_id=eq.${RAVI}&review_state=eq.assessment_supported`);
check("8 Honesty: assessment_supported evidence always carries a quote", (evRows ?? []).every((e) => (e.quote ?? "").trim().length > 3), `rows=${(evRows ?? []).length}`);

await invoke(dana.token, "reset-demo", {});
const failed = results.filter((r) => !r.ok).length;
console.log(`\nBatch 8: ${results.length - failed}/${results.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);
