// Batch 1 verification (role navigation + HR skill-graph authorization):
// 1.1 covered by navigation.test.ts (item-level filtering per role).
// 1.2/1.3 live: skill-match authorization against the deployed function using
// the real demo personas (hr_partner org scope, manager team, employee self,
// recruiter candidates, IT denied).
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

const twins = (await restGet(dana.token, "digital_twins?select=id,org_id,role,name,email,manager_id")) ?? [];
const byId = (id) => twins.find((t) => t.id === id);
const jordan = twins.find((t) => t.role === "manager");
const chris = twins.find((t) => t.role === "recruiter");
const riley = twins.find((t) => t.role === "hr_partner");
const it = twins.find((t) => t.role === "it_security");
const alex = twins.find((t) => t.id === "22222222-2222-2222-2222-222222222203");
const employeeTarget = twins.find((t) => t.role === "employee" && t.id !== alex.id);
const candidateTarget = twins.find((t) => t.role === "candidate");

// jordan's reporting subtree (within org) to pick a teammate and a stranger.
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
const teammateTarget = twins.find((t) => t.id !== jordan.id && subtree.has(t.id) && t.role !== "candidate");
const strangerTarget = twins.find((t) => !subtree.has(t.id) && t.role === "employee" && t.id !== alex.id);

const req = (await restGet(dana.token, "job_requisitions?select=id&limit=1"))?.[0];
check("setup: personas and requisition resolve", Boolean(jordan && chris && riley && alex && employeeTarget && candidateTarget && req), `jordan=${jordan?.name} team=${teammateTarget?.name} stranger=${strangerTarget?.name}`);

const signinAs = async (twin) => (twin ? await signin(twin.email) : null);

const rileyS = await signinAs(riley);
const alexS = await signinAs(alex);
const jordanS = await signinAs(jordan);
const chrisS = await signinAs(chris);
const itS = await signinAs(it);

// ---- 1.2 HR partner org-workforce scope -------------------------------------
const r1 = await invoke(rileyS.token, "skill-match", { twin_id: employeeTarget.id, target_id: req.id });
check("1.2 hr_partner matches an org employee (scope org)", r1.status === 200 && r1.j?.scope === "org", `status=${r1.status} scope=${r1.j?.scope}`);
const r2 = await invoke(rileyS.token, "skill-match", { twin_id: candidateTarget.id, target_id: req.id });
check("1.2 hr_partner cannot evaluate candidates", r2.status === 403, `status=${r2.status}`);

// ---- 1.3 employee self-only -------------------------------------------------
const e1 = await invoke(alexS.token, "skill-match", { twin_id: alex.id, target_id: req.id });
check("1.3 employee self is allowed", e1.status === 200 && e1.j?.scope === "self", `status=${e1.status} scope=${e1.j?.scope}`);
const e2 = await invoke(alexS.token, "skill-match", { twin_id: employeeTarget.id, target_id: req.id });
check("1.3 employee other person denied", e2.status === 403, `status=${e2.status}`);

// ---- 1.3 manager team scope -------------------------------------------------
const m1 = await invoke(jordanS.token, "skill-match", { twin_id: teammateTarget.id, target_id: req.id });
check("1.3 manager team member allowed", m1.status === 200 && (m1.j?.scope === "team" || m1.j?.scope === "self"), `status=${m1.status} scope=${m1.j?.scope}`);
const m2 = await invoke(jordanS.token, "skill-match", { twin_id: strangerTarget.id, target_id: req.id });
check("1.3 manager outside team denied", m2.status === 403, `status=${m2.status}`);

// ---- 1.3 recruiter candidates-only ------------------------------------------
const c1 = await invoke(chrisS.token, "skill-match", { twin_id: candidateTarget.id, target_id: req.id });
check("1.3 recruiter candidate allowed", c1.status === 200 && c1.j?.scope === "candidates", `status=${c1.status} scope=${c1.j?.scope}`);
const c2 = await invoke(chrisS.token, "skill-match", { twin_id: employeeTarget.id, target_id: req.id });
check("1.3 recruiter employee denied", c2.status === 403, `status=${c2.status}`);

// ---- 1.3 IT denied -----------------------------------------------------------
if (it) {
  const i1 = await invoke(itS.token, "skill-match", { twin_id: employeeTarget.id, target_id: req.id });
  check("1.3 IT general match denied", i1.status === 403, `status=${i1.status}`);
} else {
  console.log("SKIP  IT persona not seeded — covered by unit tests");
}

await invoke(dana.token, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
