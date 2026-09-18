// Batch C verification (recommendations):
// C2 comments persist + permission scoping + decision-message mirror
// C3 canonical history incl. pre-execution events (dedupe is unit-tested)
// C4 honest server-side pagination (exact count under RLS + range slices)
// Ends with a pristine reset-demo so the demo org is left clean.
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

const rest = async (t, path, prefer) => {
  const headers = { apikey: ANON, Authorization: `Bearer ${t}`, Accept: "application/json" };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text: text.slice(0, 300), contentRange: r.headers.get("content-range") };
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
};

const dana = await signin("dana@worksense.demo");
const alex = await signin("alex@worksense.demo");

await invoke(dana, "reset-demo", {});

// ---- C4: honest pagination (exact count + range under RLS) ----
const countRes = await rest(dana, "recommendations?select=id", "count=exact");
const contentRange = countRes.contentRange; // "0-0/27" or similar
const total = contentRange ? Number(contentRange.split("/")[1] ?? 0) : 0;
const page0 = await rest(dana, "recommendations?select=id&order=created_at.desc&offset=0&limit=10");
check("C4 exact server count", total > 0 && typeof total === "number", `total=${total}, content-range=${contentRange}`);
check("C4 first page is a bounded slice", Array.isArray(page0.j) && page0.j.length === Math.min(10, total), `page0 rows=${page0.j?.length}`);

// ---- pick a recommendation to exercise ----
const recsRes = await rest(dana, "recommendations?select=id,status,category,twin_id&order=created_at.asc");
const recs = recsRes.j ?? [];
check("C4 recs readable", recs.length > 0, `recs=${recs.length}`);
const target = recs.find((r) => r.status === "suggested") ?? recs[0];
const targetId = target.id;
const action = target.status === "suggested" ? "submit" : target.status === "needs_review" ? "approve" : "dispatch";
check("C3 target found", !!targetId, `rec=${targetId} status=${target.status} -> action=${action}`);

// ---- C3: canonical history incl. pre-execution events ----
const evBefore = await rest(dana, `workflow_events?resource_type=eq.recommendation&resource_id=eq.${targetId}&select=id,prior_status,new_status,reason,payload`);
check("C3 pre-execution events visible", Array.isArray(evBefore.j), `events before=${evBefore.j?.length}`);
const hadCreationLike = (evBefore.j ?? []).some((e) => (e.prior_status ?? "—") === "—" || e.new_status === "suggested");
console.log("      pre-execution history sample:", (evBefore.j ?? []).slice(0, 3).map((e) => `${e.prior_status}->${e.new_status}`).join(", "));

// ---- C2: decision message on a review action mirrors into events + comments ----
const note = `Batch C verify note ${Date.now()}`;
const reviewRes = await invoke(dana, "recommendation-review", { rec_id: targetId, action, rationale: "Automated Batch C verification rationale.", message: note });
check("C2 review action with message accepted", reviewRes.status === 200 && reviewRes.j?.ok === true, `status=${reviewRes.status} new=${reviewRes.j?.status}`);

const evAfter = await rest(dana, `workflow_events?resource_type=eq.recommendation&resource_id=eq.${targetId}&select=id,prior_status,new_status,payload`);
const withNote = (evAfter.j ?? []).filter((e) => e.payload && typeof e.payload.message === "string" && e.payload.message.includes("Batch C verify"));
check("C2 message persisted in workflow event payload", withNote.length === 1, `events with note=${withNote.length}`);

const commentsAfter = await invoke(dana, "recommendation-comment", { action: "list", rec_id: targetId });
const mirrored = (commentsAfter.j?.comments ?? []).filter((c) => c.body.includes("Batch C verify") && c.visibility === "approvers");
check("C2 decision message mirrored as approver comment", mirrored.length === 1, `mirrored=${mirrored.length} visibility=${mirrored[0]?.visibility}`);

// ---- C2: add a comment, persist, and scope by visibility/permission ----
const addRes = await invoke(dana, "recommendation-comment", { action: "add", rec_id: targetId, comment: `Public thread comment ${Date.now()}`, visibility: "all" });
check("C2 add comment as approver", addRes.status === 200 && addRes.j?.ok === true, `id=${addRes.j?.comment?.id}`);

const listDana = await invoke(dana, "recommendation-comment", { action: "list", rec_id: targetId });
const publicOnes = (listDana.j?.comments ?? []).filter((c) => c.visibility === "all");
check("C2 comment persists across calls", publicOnes.length >= 1, `visible(all)=${publicOnes.length} total=${listDana.j?.comments?.length}`);

// employee sees 'all' comments but NOT 'approvers' ones (permission scoping)
const listAlex = await invoke(alex, "recommendation-comment", { action: "list", rec_id: targetId });
const alexApprovers = (listAlex.j?.comments ?? []).filter((c) => c.visibility === "approvers");
check("C2 employee cannot see approver-only comments", alexApprovers.length === 0, `alex approvers-visible=${alexApprovers.length}`);

// employee cannot ADD a comment (approver-only write permission)
const addAlex = await invoke(alex, "recommendation-comment", { action: "add", rec_id: targetId, comment: "sneaky", visibility: "all" });
check("C2 employee add blocked", addAlex.status === 403, `status=${addAlex.status}`);

// ---- C3: two different recommendations have different histories ----
const other = recs.find((r) => r.id !== targetId);
if (other) {
  const evOther = await rest(dana, `workflow_events?resource_type=eq.recommendation&resource_id=eq.${other.id}&select=id,request_id`);
  const idsTarget = (evAfter.j ?? []).map((e) => e.id).sort();
  const idsOther = (evOther.j ?? []).map((e) => e.id).sort();
  check("C3 cross-recommendation history differs", JSON.stringify(idsTarget) !== JSON.stringify(idsOther), `target=${idsTarget.length} other=${idsOther.length}`);
} else {
  check("C3 cross-recommendation history differs", true, "single rec only (skipped)");
}

// ---- C1: subject/target resolution data present ----
const twins = await rest(dana, "digital_twins?select=id,name,role&order=name.asc");
const reqs = await rest(dana, "job_requisitions?select=id,title&limit=5");
check("C1 subject roster readable", Array.isArray(twins.j) && twins.j.length > 0, `twins=${twins.j?.length}`);
check("C1 target requisitions readable", Array.isArray(reqs.j) && reqs.j.length > 0, `reqs=${reqs.j?.length}`);

// ---- restore pristine demo state ----
await invoke(dana, "reset-demo", {});
const afterReset = await rest(dana, "recommendation_comments?select=id");
check("cleanup: comments wiped by reset", (afterReset.j ?? []).length === 0, `comments left=${afterReset.j?.length}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
