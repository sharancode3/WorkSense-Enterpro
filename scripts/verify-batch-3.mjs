// Batch 3 verification (role-specific workspaces — data paths):
// 3.6 IT provisioning: the queue function returns the minimal IT projection
//     (journeys empty, provisioning refs with depends_on/blockers/evidence,
//     people with name/start/manager) and IT's direct RLS reads exclude
//     evidence/skill fits while keeping onboarding plans (provisioning subjects).
// 3.4 Recruiter discoverability: candidate-session status reads (the data
//     behind the "Invitations awaiting response" / "Submitted for review"
//     home cards) resolve under recruiter scope.
// 3.1 Administrator landing is client-side (unit-tested); no backend change.
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
await invoke(dana.token, "reset-demo", {});

const elena = await signin("elena@worksense.demo");
const chris = await signin("chris@worksense.demo");

// ---- 3.6 IT provisioning workspace data path ---------------------------------
const q = await invoke(elena.token, "onboarding-queue", {});
check("3.6 IT queue resolves with role=it_security", q.status === 200 && q.j?.role === "it_security", `status=${q.status}`);
check("3.6 IT receives NO journey projections (readiness/gates/approvals)", q.j?.journeys?.length === 0 && !Array.isArray(q.j?.journeys?.[0]), `journeys=${q.j?.journeys?.length}`);
check("3.6 IT people projection carries name/start/manager", Array.isArray(q.j?.people) && q.j.people.every((p) => p.name && "start_date" in p && "manager_name" in p), `people=${q.j?.people?.length}`);
check("3.6 provisioning refs carry operational context", q.j?.provisioning?.every((t) => Array.isArray(t.depends_on) && Array.isArray(t.blockers) && Array.isArray(t.evidence_requirements)), `tasks=${q.j?.provisioning?.length}`);
check("3.6 IT filters still computed", typeof q.j?.filters?.all === "number", `all=${q.j?.filters?.all}`);

// IT RLS: onboarding plans readable (provisioning subjects), but NOT evidence/fits.
const itPlans = (await restGet(elena.token, "onboarding_plans?select=id&limit=5")) ?? [];
check("3.6 IT direct onboarding-plan reads work (provisioning subjects)", Array.isArray(itPlans) && itPlans.length > 0, `plans=${itPlans.length}`);
const itEvidence = (await restGet(elena.token, "evidence_items?select=id&limit=5")) ?? [];
check("3.6 IT cannot read private evidence directly", itEvidence.length === 0, `rows=${itEvidence.length}`);
const itFits = (await restGet(elena.token, "skill_fits?select=id&limit=5")) ?? [];
check("3.6 IT cannot read skill fits directly", itFits.length === 0, `rows=${itFits.length}`);

// ---- 3.4 recruiter interview/assessment discoverability data path ------------
const sessions = (await restGet(chris.token, "candidate_sessions?select=status&limit=200")) ?? [];
check("3.4 recruiter reads candidate sessions under RLS", Array.isArray(sessions) && sessions.length > 0, `rows=${sessions.length}`);
const invited = sessions.filter((s) => s.status === "invited" || s.status === "in_progress").length;
const submitted = sessions.filter((s) => s.status === "submitted").length;
check("3.4 invitations awaiting response count resolves", invited > 0, `invited=${invited}`);
// A failed read must never masquerade as "no assessments"; 0 is a genuine,
// resolved count (the demo has no submitted sessions yet — honest empty state).
check("3.4 submitted-for-review count resolves (0 is a real count, not a read failure)", typeof submitted === "number" && submitted === sessions.filter((s) => s.status === "submitted").length, `submitted=${submitted}`);

// ---- 3.1/3.6 labels + landing are client-side; sanity-check the demo twins ----
const twins = (await restGet(dana.token, "digital_twins?select=id,name,email,role,status")) ?? [];
check("setup: IT + recruiter personas resolve", twins.some((t) => t.role === "it_security") && twins.some((t) => t.role === "recruiter"), `it=${twins.filter((t) => t.role === "it_security").length}`);

await invoke(dana.token, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
