// Batch F verification (admin overview search + staffing comprehension):
// F1: overview-search — org vs team scope decided server-side, candidate and
//     requisition groups HR-only, bounded results, short-query guard, 403 for
//     non-HR/managers.
// F2: staffing proposal binds the selected option + scenario version.
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
const restGet = async (t, path) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${t}` },
  });
  return r.ok ? await r.json() : null;
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
};

const dana = await signin("dana@worksense.demo");
await invoke(dana, "reset-demo", {});

// ---- F1: overview search ----------------------------------------------------
const s1 = await invoke(dana, "overview-search", { q: "backend" });
check("F1 HR search succeeds with org scope", s1.status === 200 && s1.j?.ok && s1.j?.scope === "org", `scope=${s1.j?.scope}`);
check("F1 roles group returns the Backend Engineer requisition", Array.isArray(s1.j?.roles) && s1.j.roles.some((r) => r.title.toLowerCase().includes("backend")), `roles=${s1.j?.roles?.length}`);
check("F1 candidates group present for HR (server-gated)", Array.isArray(s1.j?.candidates), `candidates=${s1.j?.candidates?.length}`);
check("F1 people group is bounded to 5", Array.isArray(s1.j?.people) && s1.j.people.length <= 5, `people=${s1.j?.people?.length}`);
check("F1 bounded results carry deep-link fields", s1.j.people.every((p) => p.id && p.name) && s1.j.roles.every((r) => r.id && r.title), "id+name/title on rows");

const s2 = await invoke(dana, "overview-search", { q: "zzzqnone" });
check("F1 no-match returns empty groups", s2.j && s2.j.people.length === 0 && s2.j.candidates.length === 0 && s2.j.roles.length === 0, "all empty");

const s3 = await invoke(dana, "overview-search", { q: "a" });
check("F1 short query is guarded (min 2 chars)", s3.j && s3.j.people.length === 0 && s3.j.roles.length === 0, "empty for 1-char query");

const s4 = await invoke(dana, "overview-search", { q: "priya" });
check("F1 candidate-name search returns the candidates group", Array.isArray(s4.j?.candidates) && s4.j.candidates.length > 0 && s4.j.candidates[0].name.toLowerCase().includes("priya"), `candidates=${s4.j?.candidates?.length}`);

const jordan = await signin("jordan@worksense.demo");
const m1 = await invoke(jordan, "overview-search", { q: "eng" });
check("F1 manager search returns team scope", m1.status === 200 && m1.j?.scope === "team", `scope=${m1.j?.scope}`);
check("F1 manager never sees candidates/requisitions (item 29)", m1.j && m1.j.candidates.length === 0 && m1.j.roles.length === 0, `cand=${m1.j?.candidates?.length} roles=${m1.j?.roles?.length}`);
check("F1 manager people stay inside the reporting subtree", Array.isArray(m1.j?.people) && m1.j.people.length <= 5, `people=${m1.j?.people?.length}`);

const alex = await signin("alex@worksense.demo");
const forbidden = await invoke(alex, "overview-search", { q: "eng" });
check("F1 employees are forbidden server-side", forbidden.status === 403, `status=${forbidden.status}`);

// ---- F2: staffing proposal binds option + scenario version -------------------
const p = await invoke(dana, "staffing-comparison", {
  action: "plan",
  name: "Batch F binding check",
  demand_title: "Senior Backend Engineer",
  deadline_days: 42,
  budget_usd: 60000,
  capacity_people: 1,
  required_skills: [{ skill: "Go", min_proficiency: 3, mandatory: true }, { skill: "REST APIs", min_proficiency: 3, mandatory: true }],
});
const scenarioId = p.j?.scenario_id;
check("F2 plan runs and saves the scenario", p.status === 200 && p.j?.ok && Boolean(scenarioId), `scenario=${scenarioId?.slice(0, 8)}`);
check("F2 plan exposes options for selection", Array.isArray(p.j?.options) && p.j.options.length >= 2, `options=${p.j?.options?.length}`);

const prop1 = await invoke(dana, "staffing-comparison", { action: "propose", scenario_id: scenarioId, option_id: "hire" });
check("F2 propose binds the selected option", prop1.status === 200 && prop1.j?.option_id === "hire", `option=${prop1.j?.option_id}`);
check("F2 proposal records the option label", prop1.j?.option_label && typeof prop1.j.option_label === "string", `label=${prop1.j?.option_label}`);
check("F2 proposal records the scenario version fingerprint", typeof prop1.j?.scenario_version === "string" && /^v:v1\/input:/.test(prop1.j.scenario_version), `version=${prop1.j?.scenario_version}`);

// Persisted row readable at dana's RLS scope with option + version columns.
const row = await restGet(dana, `staffing_proposals?id=eq.${prop1.j?.proposal_id}&select=id,option_id,option_label,scenario_version,option_snapshot`);
check("F2 bound proposal persisted (RLS org read)", Array.isArray(row) && row.length === 1 && row[0].option_id === "hire" && row[0].option_snapshot?.ready_at_days, `row.option_id=${row?.[0]?.option_id} ready=${row?.[0]?.option_snapshot?.ready_at_days}`);

const propBad = await invoke(dana, "staffing-comparison", { action: "propose", scenario_id: scenarioId, option_id: "bogus" });
check("F2 invalid option is rejected (nothing submitted)", propBad.status === 400 && propBad.j?.error === "VALIDATION_ERROR", `status=${propBad.status}`);
const propNoOpt = await invoke(dana, "staffing-comparison", { action: "propose", scenario_id: scenarioId });
check("F2 missing option is rejected", propNoOpt.status === 400, `status=${propNoOpt.status}`);

await invoke(dana, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
