// Batch 7 verification (role-relevant fictional data — demo org only):
// Differentiated candidate-session states (submitted+reviewed / in_progress /
// expired), a seeded human-reviewed evidence loop with a verbatim source quote,
// the live acceptance surfaces (Priya + disposable) left untouched, a
// partial-data candidate that is NOT exceptional, and a risk mix where most
// employees are not high-risk. Ends with a pristine reset.
const URL = "https://spb-t4nma58f2hzmq798.supabase.opentrust.net";
const ANON =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5tYTU4ZjJoem1xNzk4IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk3MjQ1NDIsImV4cCI6MjEwNTMwMDU0Mn0.AKSYO90RFADUoLdCndEbqmJQRQDqUpAXukKxCIJLPAQ";
const PW = "WorkSenseDemo!2026";
const RAVI = "22222222-2222-2222-2222-222222222240";
const JUNO = "22222222-2222-2222-2222-222222222241";
const PRIYA = "22222222-2222-2222-2222-222222222205";
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

// ---- Differentiated session states for Ravi (real rows) --------------------
const raviSessions = await restGet(chris.token, `candidate_sessions?select=id,session_type,status,expires_at,submitted_at&twin_id=eq.${RAVI}&order=created_at`);
const byType = Object.fromEntries((raviSessions ?? []).map((s) => [s.session_type, s.status]));
check("7 candidate fixture: Ravi work_sample submitted", byType.work_sample === "submitted", `status=${byType.work_sample}`);
check("7 candidate fixture: Ravi interview in_progress", byType.interview === "in_progress", `status=${byType.interview}`);
check("7 candidate fixture: Ravi knowledge check expired", byType.knowledge_assessment === "expired", `status=${byType.knowledge_assessment}`);
const expiredPast = (raviSessions ?? []).find((s) => s.session_type === "knowledge_assessment");
check("7 expired deadline is in the past (no future expiry)", Boolean(expiredPast && new Date(expiredPast.expires_at).getTime() < Date.now()), `expires=${expiredPast?.expires_at}`);

// ---- Reviewed evidence loop (source-linked, verbatim quote) ----------------
const raviWork = (raviSessions ?? []).find((s) => s.session_type === "work_sample");
const fetchRes = await invoke(chris.token, "assessment-session", { action: "fetch", session_id: raviWork.id });
const evaluation = fetchRes.j?.evaluation;
check("7 evaluated assessment exists for the submitted work sample", Boolean(evaluation?.assessment_id), `assessment=${evaluation?.assessment_id?.slice(0, 8)}`);
check("7 evaluation was human-reviewed (reviewed_at set)", Boolean(evaluation?.reviewed && evaluation.reviewed.determination === "confirm"), `by=${evaluation?.reviewed?.by} at=${evaluation?.reviewed?.at}`);
const evQuote = evaluation?.ai?.judgments?.[0]?.evidence_quotes?.[0];
const answerText = Object.values(fetchRes.j?.session?.answers ?? {}).join(" ");
check("7 evidence quote is a verbatim substring of the stored answer (no generic 'resume')", Boolean(evQuote && answerText.includes(evQuote)), `quote="${evQuote?.slice(0, 40)}…"`);
const evRows = await restGet(chris.token, `evidence_items?select=source_type,source_id,quote,review_state&twin_id=eq.${RAVI}&review_state=eq.assessment_supported`);
check("7 source-linked evidence row persisted from the review", (evRows ?? []).length >= 1 && evRows[0].source_type === "work_sample", `source_id=${evRows?.[0]?.source_id?.slice(0, 32)}…`);

// ---- Live acceptance surfaces untouched ------------------------------------
const invited = await restGet(chris.token, `candidate_sessions?select=status&status=eq.invited&org_id=eq.11111111-1111-1111-1111-111111111111`);
check("7 Priya + disposable invited sessions preserved (6)", (invited ?? []).length === 6, `count=${(invited ?? []).length}`);
const q = await invoke(chris.token, "assessment-queue", {});
const submittedList = q.j?.queues?.submitted_assessments ?? [];
check("7 hiring queue sees Ravi's reviewed submission (submitted + not incomplete)", submittedList.some((s) => s.session_id === raviWork.id) && !(q.j?.queues?.incomplete_scorecards ?? []).some((s) => s.session_id === raviWork.id), `submitted=${submittedList.length} incomplete=${q.j?.queues?.incomplete_scorecards?.length}`);

// ---- Partial-data candidate is honest, not exceptional ---------------------
const junoDocs = await restGet(dana.token, `resume_documents?select=file_name,status,low_text&twin_id=eq.${JUNO}`);
check("7 partial-data candidate (Juno) stays low-text/unverified", (junoDocs ?? []).some((d) => d.low_text === true && d.status === "low_text"), `docs=${(junoDocs ?? []).length}`);

// ---- Not every employee is high-risk ---------------------------------------
const cases = await restGet(dana.token, `workforce_review_cases?select=priority&org_id=eq.11111111-1111-1111-1111-111111111111`);
const prio = {};
for (const c of cases ?? []) prio[c.priority] = (prio[c.priority] ?? 0) + 1;
check("7 risk mix is not uniformly high (low > high)", (prio.low ?? 0) > (prio.high ?? 0), `low=${prio.low} med=${prio.medium} high=${prio.high} review=${prio.review}`);

// ---- Pristine reset ---------------------------------------------------------
await invoke(dana.token, "reset-demo", {});
const after = await restGet(chris.token, `candidate_sessions?select=status&status=eq.invited&org_id=eq.11111111-1111-1111-1111-111111111111`);
check("teardown: reset re-seeds the differentiated fixture state", (after ?? []).length === 6, `count=${(after ?? []).length}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\nBatch 7: ${results.length - failed}/${results.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);
