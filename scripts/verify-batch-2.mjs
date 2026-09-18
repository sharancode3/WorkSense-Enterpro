// Batch 2 verification (backend + direct-table scope):
// 2.1 onboarding-queue allowlist + role scopes (recruiter rejected, employee
//     self, manager recursive team, HR org).
// 2.2 direct-table RLS reads under real identities (employee self-only plans,
//     recruiter no plan visibility but candidate applications, HR partner no
//     candidate twins).
// 2.4 suspended account is rejected by the queue function (server-side guard).
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

const twins = (await restGet(dana.token, "digital_twins?select=id,role,name,email,manager_id,status")) ?? [];
const byId = (id) => twins.find((t) => t.id === id);
const jordan = twins.find((t) => t.role === "manager");
const chris = twins.find((t) => t.role === "recruiter");
const riley = twins.find((t) => t.role === "hr_partner");
const alex = twins.find((t) => t.role === "employee" && t.id === "22222222-2222-2222-2222-222222222203");
const allEmployees = twins.filter((t) => t.role === "employee");
check("setup: personas resolve", Boolean(jordan && chris && riley && alex && allEmployees.length >= 2), `employees=${allEmployees.length}`);

// jordan's recursive reporting subtree.
const subtree = new Set([jordan.id]);
let grew = true;
while (grew) {
  grew = false;
  for (const t of twins) {
    if (t.manager_id && subtree.has(t.manager_id) && !subtree.has(t.id)) {
      subtree.add(t.id);
      grew = true;
    }
  }
}
const jordanTeamIds = allEmployees.filter((e) => subtree.has(e.id)).map((e) => e.id);

const alexS = await signin(alex.email);
const jordanS = await signin(jordan.email);
const chrisS = await signin(chris.email);
const rileyS = await signin(riley.email);

// ---- 2.1 queue allowlist + role scopes --------------------------------------
const qRec = await invoke(chrisS.token, "onboarding-queue", {});
check("2.1 recruiter is rejected (no HR fallback)", qRec.status === 403, `status=${qRec.status}`);

const qEmp = await invoke(alexS.token, "onboarding-queue", {});
check("2.1 employee sees role=employee", qEmp.status === 200 && qEmp.j?.role === "employee", `role=${qEmp.j?.role}`);
check("2.1 employee journeys are self-only", qEmp.j?.journeys.every((j) => j.twin_id === alex.id), `journeys=${qEmp.j?.journeys?.length}`);

const qMgr = await invoke(jordanS.token, "onboarding-queue", {});
check("2.1 manager sees role=manager", qMgr.status === 200 && qMgr.j?.role === "manager", `role=${qMgr.j?.role}`);
check("2.1 manager journeys stay in the reporting subtree", qMgr.j?.journeys.every((j) => jordanTeamIds.includes(j.twin_id)), `ids=${qMgr.j?.journeys?.map((j) => j.twin_id.slice(-3)).join(",")}`);

const qHr = await invoke(rileyS.token, "onboarding-queue", {});
check("2.1 HR partner sees org journeys (role=hr)", qHr.status === 200 && qHr.j?.role === "hr" && qHr.j?.journeys.length > 0, `journeys=${qHr.j?.journeys?.length}`);

// ---- 2.2 direct-table RLS reads ---------------------------------------------
const alexPlans = (await restGet(alexS.token, "onboarding_plans?select=id,twin_id&order=version.desc")) ?? [];
check("2.2 employee direct plan reads are self-only", alexPlans.every((p) => p.twin_id === alex.id), `rows=${alexPlans.length} twins=${[...new Set(alexPlans.map((p) => p.twin_id.slice(-3)))].join(",")}`);

const chrisPlans = (await restGet(chrisS.token, "onboarding_plans?select=id,twin_id")) ?? [];
check("2.2 recruiter cannot read onboarding plans", chrisPlans.length === 0, `rows=${chrisPlans.length}`);

const chrisApps = (await restGet(chrisS.token, "applications?select=id,candidate_twin_id&limit=5")) ?? [];
check("2.2 recruiter retains candidate application reads", Array.isArray(chrisApps) && chrisApps.length > 0, `apps=${Array.isArray(chrisApps) ? chrisApps.length : "err"}`);

const alexFits = (await restGet(alexS.token, "skill_fits?select=id,twin_id&limit=20")) ?? [];
check("2.2 employee direct skill_fit reads are self-only", alexFits.every((f) => f.twin_id === alex.id), `rows=${alexFits.length}`);

const rileyTwins = (await restGet(rileyS.token, "digital_twins?select=id,role&limit=100")) ?? [];
check("2.2 HR partner sees org workforce, never candidates", rileyTwins.every((t) => t.role !== "candidate") && rileyTwins.some((t) => t.role === "employee"), `rows=${rileyTwins.length} roles=${[...new Set(rileyTwins.map((t) => t.role))].join(",")}`);

const jordanPlans = (await restGet(jordanS.token, "onboarding_plans?select=id,twin_id&order=version.desc&limit=50")) ?? [];
check("2.2 manager direct plan reads are team-only", jordanPlans.every((p) => jordanTeamIds.includes(p.twin_id)), `rows=${jordanPlans.length}`);

const alexEvidence = (await restGet(alexS.token, "evidence_items?select=id,twin_id&limit=50")) ?? [];
check("2.2 employee direct evidence reads are self-only", alexEvidence.every((e) => e.twin_id === alex.id), `rows=${alexEvidence.length}`);

// ---- 2.4 suspended account guard --------------------------------------------
const susp = await invoke(dana.token, "admin-access", { action: "suspend", target_twin_id: alex.id, reason: "Batch 2 verification" });
check("2.4 suspend succeeds", susp.status === 200 && susp.j?.status === "suspended", `status=${susp.j?.status}`);
const qSusp = await invoke(alexS.token, "onboarding-queue", {});
check("2.4 suspended account rejected by the queue function", qSusp.status === 403, `status=${qSusp.status}`);
const rea = await invoke(dana.token, "admin-access", { action: "reactivate", target_twin_id: alex.id, reason: "Batch 2 verification" });
check("2.4 reactivation restores access", rea.status === 200 && rea.j?.status === "active", `status=${rea.j?.status}`);

await invoke(dana.token, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
