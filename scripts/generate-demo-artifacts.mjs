// ---------------------------------------------------------------------------
// Phase 14 — generate pre-validated demo artifacts for backup/fallback use.
// Each artifact is labeled "Previously generated demo artifact" and is NEVER
// presented as live inference. Run while the Qwen gateway is healthy:
//   node scripts/generate-demo-artifacts.mjs  ->  public/demo-artifacts/*.json
// On gateway failure it writes a truthful unavailable marker instead.
// ---------------------------------------------------------------------------
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "demo-artifacts");
mkdirSync(OUT, { recursive: true });
const URL = "https://spb-t4npm21yg2263xt4.supabase.opentrust.net";
const ANON = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5wbTIxeWcyMjYzeHQ0IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk2MTk0NzUsImV4cCI6MjEwNTE5NTQ3NX0.TGw9lq8-PYVBdmlLvt3O-xTIqRRRBUh3ZHQih7j7m9M";
const PW = "WorkSenseDemo!2026";
const REQ = "33333333-3333-3333-3333-333333333301";
const WORK_SESSION = "77777777-7777-7777-7777-777777777701";

async function signin(e){const r=await fetch(`${URL}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({email:e,password:PW})});const j=await r.json();if(!j.access_token)throw new Error("signin "+e);return j.access_token;}
async function invoke(t,fn,b,to=240000){const t0=Date.now();const r=await fetch(`${URL}/functions/v1/${fn}`,{method:"POST",headers:{apikey:ANON,Authorization:`Bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify(b??{})});const x=await r.text();let j=null;try{j=JSON.parse(x)}catch{}return{status:r.status,ms:Date.now()-t0,j,text:x.slice(0,300)};}
async function pollJob(t,jobId,to=180000){const t0=Date.now();for(;;){const r=await invoke(t,"model-job",{job_id:jobId},30000);const s=r.j?.job?.status;if(r.j?.job&&["succeeded","failed","cancelled"].includes(s))return{...r.j.job,pollMs:Date.now()-t0};if(Date.now()-t0>to)return{timeout:true,status:s};await new Promise(r=>setTimeout(r,1000));}}

const label = (payload) => ({
  _provenance: "previously-generated-demo-artifact",
  _label: "Previously generated demo artifact. Not live inference.",
  _generated_at: new Date().toISOString(),
  _model: "qwen3:4b-instruct-2507-q4_K_M",
  ...payload,
});
const writeArtifact = (name, obj) => {
  writeFileSync(join(OUT, name), JSON.stringify(obj, null, 2));
  console.log("wrote", name);
};

const dana = await signin("dana@worksense.demo");
const chris = await signin("chris@worksense.demo");

// 1. policy — grounded (sick leave) + abstain (mobility PIP)
for (const [name, q] of [["policy-grounded", "How many paid sick days do employees get per year?"], ["policy-abstain", "Can an employee apply for an internal role while on a performance improvement plan?"]]) {
  const r = await invoke(dana, "policy-qa", { question: q, employee_id: "22222222-2222-2222-2222-222222222203" }, 240000);
  writeArtifact(`${name}.json`, label({ label: `Policy demo: ${name}`, question: q, status: r.j?.status, abstained: r.j?.abstained, answer: r.j?.answer ?? "", citations: (r.j?.citations ?? []).map((c) => ({ doc_code: c.doc_code, section: c.section, exact_quote: c.exact_quote })), note: r.j?.note ?? null, live_ms: r.ms }));
}

// 2. resume extraction — fixture A (strong) and B (keyword-heavy)
for (const [name, f] of [["extraction-fixture-a", "fixture-a-priya-nair"], ["extraction-fixture-b", "fixture-b-dev-mehta"]]) {
  const text = readFileSync(join(root, "public", "demo-fixtures", `${f}.txt`), "utf8");
  let r = await invoke(chris, "extract-resume", { twin_id: "22222222-2222-2222-2222-222222222205", resume_text: text, req_id: REQ }, 60000);
  if (!r.j?.ok && /MODEL_OUTPUT_INVALID/.test(r.text)) {
    await new Promise((res) => setTimeout(res, 1500));
    r = await invoke(chris, "extract-resume", { twin_id: "22222222-2222-2222-2222-222222222205", resume_text: text, req_id: REQ }, 60000);
  }
  if (r.j?.ok) {
    const job = await pollJob(chris, r.j.job_id);
    writeArtifact(`${name}.json`, label({
      label: `Resume extraction demo: ${name}`,
      fixture: `${f}.pdf`,
      full_name: job.full_name ?? r.j.full_name,
      years_experience: job.years_experience ?? r.j.years_experience,
      extracted_skills: (job.extracted_skills ?? r.j.extracted_skills ?? []).map((s) => ({ name: s.name, proficiency: s.proficiency, verification_rigor: s.verification_rigor, evidence: s.evidence ?? null })),
      live_poll_ms: job.pollMs,
    }));
  } else {
    writeArtifact(`${name}.json`, label({ label: `Resume extraction demo: ${name} (unavailable)`, available: false, reason: r.text.slice(0, 200) }));
  }
}

// 3. work-sample evaluation (Priya's submitted session)
const ev = await invoke(chris, "assessment-evaluate", { session_id: WORK_SESSION }, 240000);
if (ev.j?.ok || ev.j?.result) {
  writeArtifact("work-sample-evaluation.json", label({
    label: "Work-sample assessment demo (Payments service design)",
    session_id: WORK_SESSION,
    result: ev.j.result,
    live_ms: ev.ms,
  }));
} else {
  writeArtifact("work-sample-evaluation.json", label({ label: "Work-sample assessment demo (unavailable)", available: false, reason: ev.text.slice(0, 200) }));
}

// 4. staffing comparison (deterministic, quick)
const st = await invoke(dana, "staffing-comparison", {});
writeArtifact("staffing-comparison.json", label({ label: "Staffing planner demo (Hire/Move/Upskill/Hybrid)", scenario: st.j?.scenario, options: st.j?.options, planning_note: st.j?.planning_note, live_ms: st.ms }));

console.log("Done. Artifacts in public/demo-artifacts/ — always show with the provenance label.");
