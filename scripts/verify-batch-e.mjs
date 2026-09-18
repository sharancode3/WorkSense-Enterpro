// Batch E verification (skill graph):
// E3: complete cache fingerprint — fit.versions now records engine, evidence,
//     requisition, graph and context (seniority + artifact count).
// E4: cached result served on repeat; fingerprint drives staleness.
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

// Alex Chen (has verified skills + evidence) vs Senior Backend Engineer.
const TWIN = "22222222-2222-2222-2222-222222222203";
const REQ = "33333333-3333-3333-3333-333333333301";

const m1 = await invoke(dana, "skill-match", { twin_id: TWIN, target_id: REQ, scenario: "current" });
const v1 = m1.j?.fit?.versions;
check("E3 match succeeds", m1.status === 200 && m1.j?.ok !== false && m1.j?.fit, `status=${m1.status}`);
check("E3 fingerprint has engine+evidence+requisition+graph+context", 
  Boolean(v1?.engine && v1?.evidence && v1?.requisition && v1?.graph && v1?.context),
  `engine=${v1?.engine} graph=${v1?.graph?.slice(0,8)} context=${v1?.context?.slice(0,8)}`);

const m2 = await invoke(dana, "skill-match", { twin_id: TWIN, target_id: REQ, scenario: "current" });
check("E4 cached result served on repeat", m2.j?.cached === true, `cached=${m2.j?.cached}`);
check("E4 cached fit keeps the full fingerprint", Boolean(m2.j?.fit?.versions?.graph && m2.j?.fit?.versions?.context), "graph+context on cached fit");

const m3 = await invoke(dana, "skill-match", { twin_id: TWIN, target_id: REQ, scenario: "future" });
check("E3 future scenario also fingerprints fully", Boolean(m3.j?.fit?.versions?.graph && m3.j?.fit?.versions?.context), `future ok=${m3.status}`);

const m4 = await invoke(dana, "skill-match", { twin_id: TWIN, target_id: REQ, scenario: "current", force: true });
check("E4 force recompute returns fresh (cached=false)", m4.j?.cached === false, `cached=${m4.j?.cached}`);

// Person identity is returned so the client can bind results to the selection.
check("E4 response carries the person identity", m1.j?.person?.id === TWIN && m1.j?.person?.name, `person=${m1.j?.person?.name}`);

// RLS/permission check from a non-approver still enforced (employee sees self only).
const alex = await signin("alex@worksense.demo");
const forbidden = await invoke(alex, "skill-match", { twin_id: "22222222-2222-2222-2222-222222222205", target_id: REQ, scenario: "current" });
check("E4 permission enforced server-side (employee cannot view another)", forbidden.status === 403, `status=${forbidden.status}`);

await invoke(dana, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
