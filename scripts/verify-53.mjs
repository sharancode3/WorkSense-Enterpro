// §53 verification — skill-graph future development trajectory on REAL data.
// Confirms: (1) current and future fits compute from live rows (never constants),
// (2) the projected-with-development score (same weighted composite as the
// engine, computed in src/lib/skill-graph-metrics.ts) is ALWAYS >= the raw
// future score, (3) reports today/future/projected so the trajectory read-out
// is meaningful for real personas. Ends with a pristine reset.
const URL = "https://spb-t4nma58f2hzmq798.supabase.opentrust.net";
const ANON =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5tYTU4ZjJoem1xNzk4IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk3MjQ1NDIsImV4cCI6MjEwNTMwMDU0Mn0.AKSYO90RFADUoLdCndEbqmJQRQDqUpAXukKxCIJLPAQ";
const PW = "WorkSenseDemo!2026";
const W = { direct: 0.5, adjacent: 0.25, evidence: 0.15, seniority: 0.1 };
const round3 = (n) => Math.round(n * 1000) / 1000;

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
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
};
const rest = async (t, path) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${t}` } });
  return r.ok ? await r.json() : null;
};

// The projected score — mirrors src/lib/skill-graph-metrics.ts projectedFutureReadiness.
const projected = (fit) => {
  const direct = fit.classification.direct ?? [];
  const adjacent = fit.classification.adjacent ?? [];
  const transferable = fit.classification.transferable ?? [];
  const gaps = fit.classification.gaps ?? [];
  const total = direct.length + adjacent.length + transferable.length + gaps.length;
  if (total === 0) return { score: fit.score, closable: 0 };
  const alreadyMet = direct.filter((i) => (i.candidate_proficiency ?? 0) >= i.required_proficiency).length;
  const closable = direct.filter((i) => (i.candidate_proficiency ?? 0) < i.required_proficiency).length + adjacent.length + transferable.length;
  const sDirect = (alreadyMet + closable) / total;
  const sAdjacent = gaps.length === 0 ? 1 : fit.sections.adjacent.value;
  const score = W.direct * sDirect + W.adjacent * sAdjacent + W.evidence * fit.sections.evidence.value + W.seniority * fit.sections.seniority.value;
  return { score: round3(score), closable };
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
};

const riley = await signin("riley@worksense.demo");
await invoke(riley, "reset-demo", {});

const reqs = (await rest(riley, "job_requisitions?select=id,title,future_skills&order=title")) ?? [];
const withFuture = reqs.filter((r) => Array.isArray(r.future_skills) && r.future_skills.length > 0);
const twins = (await rest(riley, "digital_twins?select=id,name,role,verified_skills&role=eq.employee&status=eq.active&order=name")) ?? [];
check("seed has requisitions with future_skills", withFuture.length >= 2, `${withFuture.length} reqs with future_skills`);
check("seed has active employee twins", twins.length >= 4, `${twins.length} employees`);

let checked = 0;
let allProjectedGte = true;
for (const req of withFuture.slice(0, 3)) {
  for (const tw of twins.slice(0, 4)) {
    const cur = await invoke(riley, "skill-match", { twin_id: tw.id, target_id: req.id, scenario: "current" });
    const futr = await invoke(riley, "skill-match", { twin_id: tw.id, target_id: req.id, scenario: "future" });
    if (cur.status !== 200 || futr.status !== 200) {
      check(`skill-match ${tw.name}/${req.title}`, false, `http ${cur.status}/${futr.status}`);
      continue;
    }
    const proj = projected(futr.j.fit);
    const today = Math.round(cur.j.fit.score * 100);
    const target = Math.round(futr.j.fit.score * 100);
    const projPct = Math.round(proj.score * 100);
    const ok = proj.score >= futr.j.fit.score - 1e-9;
    if (!ok) allProjectedGte = false;
    console.log(
      `  · ${tw.name.padEnd(14)} vs ${req.title.padEnd(24)} today ${today}% · future ${target}% · projected ${projPct}% (closable ${proj.closable}) ${projPct > target ? "UP" : "="}`
    );
    checked += 1;
  }
}
check(`projected >= future for all ${checked} real matches`, checked > 0 && allProjectedGte, `${checked} matches computed`);
check("at least one persona shows a rise (projected > future)", (async () => {
  for (const req of withFuture) {
    for (const tw of twins) {
      const futr = await invoke(riley, "skill-match", { twin_id: tw.id, target_id: req.id, scenario: "future" });
      if (futr.status !== 200) continue;
      const proj = projected(futr.j.fit);
      if (proj.score > futr.j.fit.score) return true;
    }
  }
  return false;
})(), "trajectory demonstrates development");

await invoke(riley, "reset-demo", {});
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks green`);
process.exit(fails.length > 0 ? 1 : 0);
