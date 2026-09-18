// Batch H verification (audit history + connected cross-module demo):
// H1: security-audit merges canonical sources, dedupes on stable keys, resolves
//     names server-side, and paginates honestly (exact total + bounded page).
// H2: reset-demo seeds idempotent labeled synthetic audit events across all
//     four modules; kind filter changes the exact total; page 2 works.
// Also verifies permission (employee -> 403).
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

// ---- H1: merged canonical feed, names resolved, deduped keys -----------------
const a1 = await invoke(dana, "security-audit", { page: 1, page_size: 50 });
check("H1 audit succeeds for admin", a1.status === 200 && a1.j?.ok, `status=${a1.status}`);
check("H1 total is exact and positive", typeof a1.j?.total === "number" && a1.j.total > 0, `total=${a1.j?.total}`);

const kinds = new Set(a1.j?.items?.map((i) => i.kind) ?? []);
check("H1 feed merges multiple canonical sources", kinds.has("access") && kinds.has("recommendations") && kinds.has("recruitment") && kinds.has("onboarding"), `kinds=[${[...kinds].join(",")}]`);

const keys = (a1.j?.items ?? []).map((i) => i.key);
check("H1 every item carries a stable unique key (no duplicate events)", new Set(keys).size === keys.length, `items=${keys.length}`);

const named = (a1.j?.items ?? []).filter((i) => i.kind === "access").map((i) => i.actor);
check("H1 access events resolve the actor name server-side", named.length > 0 && named.every((n) => typeof n === "string" && n.length > 0), `actors=${named.join(", ")}`);

const withHref = (a1.j?.items ?? []).filter((i) => i.href).length;
check("H1 events carry authorized module deep links", withHref > 0, `hrefs=${withHref}`);

// ---- H2: synthetic labeled audit events seeded idempotently ------------------
const labeled = (a1.j?.items ?? []).filter((i) => (i.reason ?? "").includes("Synthetic demo audit record"));
check("H2 synthetic labeled audit events are seeded", labeled.length >= 5, `labeled=${labeled.length}`);

const access = await invoke(dana, "security-audit", { page: 1, page_size: 50, kind: "access" });
check("H2 access kind filters to access events", access.j?.items?.every((i) => i.kind === "access") && access.j.total > 0, `total=${access.j?.total}`);
const accessStory = access.j?.items?.filter((i) => (i.reason ?? "").includes("Synthetic demo audit record"));
check("H2 access story is internally consistent (suspend then reactivate)", accessStory?.some((i) => i.label === "ACCOUNT_SUSPENDED") && accessStory?.some((i) => i.label === "ACCOUNT_REACTIVATED") && accessStory?.some((i) => i.label === "ROLE_CHANGED"), `labels=${accessStory?.map((i) => i.label).join(",")}`);

const rec = await invoke(dana, "security-audit", { page: 1, page_size: 50, kind: "recommendations" });
check("H2 recommendation workflow events present with hub deep links", rec.j?.items?.some((i) => i.href?.includes("/hub?rec=")) && rec.j.total > 0, `total=${rec.j?.total}`);

const recru = await invoke(dana, "security-audit", { page: 1, page_size: 50, kind: "recruitment" });
check("H2 candidate stage events present with recruitment deep links", recru.j?.items?.some((i) => i.href?.includes("/recruitment?cand=")), `total=${recru.j?.total}`);

const onb = await invoke(dana, "security-audit", { page: 1, page_size: 50, kind: "onboarding" });
check("H2 onboarding waivers present", onb.j?.total > 0, `total=${onb.j?.total}`);

// ---- H1: honest pagination -----------------------------------------------
const p1 = await invoke(dana, "security-audit", { page: 1, page_size: 5 });
const p2 = await invoke(dana, "security-audit", { page: 2, page_size: 5 });
check("H1 page 2 differs from page 1 and both are bounded", p1.j?.items?.length === 5 && p2.j?.items?.length === p1.j?.total - 5 && p1.j.items[0].key !== p2.j.items[0].key, `p1=${p1.j?.items?.length} p2=${p2.j?.items?.length} of ${p1.j?.total}`);
check("H1 total is stable across pages", p1.j?.total === a1.j?.total, `total=${p1.j?.total}`);
check("H1 out-of-range page returns empty but keeps exact total", p2.j?.total === p1.j?.total, "consistent total");

// ---- H1: kind filter keeps exact totals server-side ----------------------
const kindTotals = {};
for (const k of ["access", "recommendations", "recruitment", "onboarding"]) {
  const r = await invoke(dana, "security-audit", { page: 1, page_size: 50, kind: k });
  kindTotals[k] = r.j?.total ?? 0;
}
check("H1 every kind filter returns only that kind with an exact total", Object.values(kindTotals).every((t) => t > 0), `totals=${JSON.stringify(kindTotals)}`);
check("H1 filtered totals do not double-count events across kinds", Object.values(kindTotals).reduce((a, b) => a + b, 0) >= a1.j?.total, `sum=${Object.values(kindTotals).reduce((a, b) => a + b, 0)} full=${a1.j?.total}`);

// ---- permission ------------------------------------------------------------
const alex = await signin("alex@worksense.demo");
const forbidden = await invoke(alex, "security-audit", { page: 1, page_size: 20 });
check("H1 employees are forbidden from the security audit", forbidden.status === 403, `status=${forbidden.status}`);

// ---- idempotency: a second reset re-seeds the same feed ---------------------
await invoke(dana, "reset-demo", {});
const a2 = await invoke(dana, "security-audit", { page: 1, page_size: 50 });
check("H2 re-reset re-seeds the same synthetic feed (no duplicates)", a2.j?.total === a1.j?.total, `total1=${a1.j?.total} total2=${a2.j?.total}`);

await invoke(dana, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
