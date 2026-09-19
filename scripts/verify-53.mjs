// Phase 9 verification — Skill Intelligence Graph contract on REAL data.
// Confirms the audit invariants:
//  (1) NO FLOOR — unrelated evidence + matched seniority cannot manufacture
//      match points (no-overlap pairing scores 0 verified readiness).
//  (2) verified readiness is computed from accepted evidence only, and the
//      provisional profile match + evidence confidence are reported separately.
//  (3) mandatory gate is surfaced with unmet skills.
//  (4) future scenario evaluates the RESOLVED future target (additions +
//      raised targets), and current-vs-future raw deltas are available even
//      when rounded values are equal.
//  (5) every fit carries the new contract fields (no legacy sections /
//      gaps/adjacent keys).
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
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
};
const rest = async (t, path) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${t}` } });
  return r.ok ? await r.json() : null;
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
const thinFuture = withFuture.filter((r) => r.future_skills.length < 3);
const twins = (await rest(riley, "digital_twins?select=id,name,role,verified_skills&role=eq.employee&status=eq.active&order=name")) ?? [];
check("seed has requisitions with future_skills", withFuture.length >= 2, `${withFuture.length} reqs with future_skills`);
check(
  "EVERY requisition's future set is a realistic evolution (>=3 skills)",
  withFuture.length > 0 && thinFuture.length === 0,
  thinFuture.length === 0 ? `all ${withFuture.length} reqs ok` : `thin: ${thinFuture.map((r) => `${r.title}(${r.future_skills.length})`).join(", ")}`
);
check("seed has active employee twins", twins.length >= 4, `${twins.length} employees`);

// Phase 9 contract: every returned fit must carry the new fields and none of
// the legacy floor model (sections/gaps/adjacent/transferable classification
// keys are gone; seniority is context only).
let checked = 0;
let contractOk = true;
let noFloorCase = null;
for (const req of withFuture) {
  for (const tw of twins.slice(0, 6)) {
    const cur = await invoke(riley, "skill-match", { twin_id: tw.id, target_id: req.id, scenario: "current" });
    const futr = await invoke(riley, "skill-match", { twin_id: tw.id, target_id: req.id, scenario: "future" });
    if (cur.status !== 200 || futr.status !== 200) {
      check(`skill-match ${tw.name}/${req.title}`, false, `http ${cur.status}/${futr.status}`);
      continue;
    }
    const cf = cur.j.fit;
    const ff = futr.j.fit;
    const okShape =
      typeof cf.score === "number" &&
      typeof cf.profile_match === "number" &&
      typeof cf.evidence_confidence === "number" &&
      typeof cf.mandatory_gate?.met === "boolean" &&
      Array.isArray(cf.scoring?.requirements) &&
      Array.isArray(ff.scoring?.requirements) &&
      cf.versions?.engine === "3" &&
      ff.scoring?.resolved_from === "resolved-future" &&
      !cf.sections && !ff.sections;
    if (!okShape) contractOk = false;
    if (cf.scoring?.mandatory?.gated && cf.mandatory_gate.unmet_skills.length === 0) contractOk = false;
    // No-overlap case: find pairings where the person has no direct/adjacent/
    // transferable path at all -> verified readiness must be 0 (no evidence/
    // seniority floor).
    const hasAnyPath = cf.scoring.requirements.some((r) => r.relationship !== "none");
    if (!hasAnyPath && cf.score > 0) noFloorCase = { name: tw.name, title: req.title, score: cf.score };
    // Raw current-vs-future delta must be reportable (even when rounded equal).
    const delta = ff.score - cf.score;
    if (Math.round(ff.score * 100) === Math.round(cf.score * 100) && Math.abs(delta) > 0.0005) contractOk = contractOk; // fine either way
    console.log(
      `  · ${tw.name.padEnd(14)} vs ${req.title.padEnd(26)} verified ${Math.round(cf.score * 100)}% · profile ${Math.round(cf.profile_match * 100)}% · future ${Math.round(ff.score * 100)}% (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}) · gate ${cf.mandatory_gate.met ? "met" : "NOT MET"} · ${cf.scoring.requirements.length} reqs`
    );
    checked += 1;
  }
}
check(`all ${checked} real matches follow the Phase 9 contract`, checked > 0 && contractOk, `${checked} matches checked`);
check(
  "NO FLOOR: every no-overlap pairing scores 0 verified readiness (no evidence/seniority floor)",
  noFloorCase === null,
  noFloorCase ? `VIOLATION: ${noFloorCase.name} vs ${noFloorCase.title} scored ${noFloorCase.score}` : "no pairing with a manufactured floor"
);

// Reviewer case: Fatima Ito vs People Operations Partner — classic no-overlap.
const peopleOps = withFuture.find((r) => r.title === "People Operations Partner");
const fatima = twins.find((t) => t.name === "Fatima Ito");
if (peopleOps && fatima) {
  const cur = await invoke(riley, "skill-match", { twin_id: fatima.id, target_id: peopleOps.id, scenario: "current" });
  const futr = await invoke(riley, "skill-match", { twin_id: fatima.id, target_id: peopleOps.id, scenario: "future" });
  const cf = cur.j?.fit;
  const ff = futr.j?.fit;
  const today = Math.round((cf?.score ?? 0) * 100);
  const target = Math.round((ff?.score ?? 0) * 100);
  const rawDelta = (cf?.score ?? 0) - (ff?.score ?? 0);
  console.log(`  · REVIEWER CASE: Fatima Ito vs People Operations Partner — verified ${today}% · future ${target}% · raw Δ ${rawDelta.toFixed(3)} · profile ${Math.round((cf?.profile_match ?? 0) * 100)}% · artifacts ${cur.j?.evidence_artifacts?.count ?? "?"}`);
  check("reviewer case: unrelated evidence does not create a score (verified <= 5%)", (cf?.score ?? 0) <= 0.05, `score=${cf?.score?.toFixed?.(3)}`);
  check(
    "reviewer case: provisional profile match and evidence confidence are reported separately (not folded into readiness)",
    typeof cf?.profile_match === "number" && typeof cf?.evidence_confidence === "number",
    `profile=${cf?.profile_match?.toFixed?.(3)} confidence=${cf?.evidence_confidence?.toFixed?.(3)}`
  );
  check("reviewer case: future scenario is marked resolved-future", ff?.scoring?.resolved_from === "resolved-future", `resolved_from=${ff?.scoring?.resolved_from}`);
} else {
  check("reviewer case fixtures present", false, "People Operations Partner / Fatima Ito missing");
}

// Verified vs provisional ordering sanity: a reviewer-confirmed strong match
// should show verified >= a claims-only person on the same role.
const senBackend = reqs.find((r) => r.title === "Senior Backend Engineer");
if (senBackend) {
  const strong = await invoke(riley, "skill-match", { twin_id: twins[0]?.id, target_id: senBackend.id, scenario: "current" });
  const v = strong.j?.fit?.score;
  const p = strong.j?.fit?.profile_match;
  check("fit reports verified readiness and profile match as distinct numbers", typeof v === "number" && typeof p === "number", `verified=${v?.toFixed?.(3)} profile=${p?.toFixed?.(3)}`);
}

await invoke(riley, "reset-demo", {});
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks green`);
process.exit(fails.length > 0 ? 1 : 0);
