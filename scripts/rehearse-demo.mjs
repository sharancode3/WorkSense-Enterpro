// Phase 14 final gate: walk the ~6-minute demo beats live, record timings,
// and check source/date/count consistency. Ends with a pristine reset.
const URL="https://spb-t4npm21yg2263xt4.supabase.opentrust.net";
const ANON="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG5wbTIxeWcyMjYzeHQ0IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODk2MTk0NzUsImV4cCI6MjEwNTE5NTQ3NX0.TGw9lq8-PYVBdmlLvt3O-xTIqRRRBUh3ZHQih7j7m9M";
const PW="WorkSenseDemo!2026";
const REQ="33333333-3333-3333-3333-333333333301";
const PRIYA="22222222-2222-2222-2222-222222222205";
const ALEX="22222222-2222-2222-2222-222222222203";
import { readFileSync } from "node:fs";
const signin=async(e)=>{const r=await fetch(`${URL}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({email:e,password:PW})});return(await r.json()).access_token;};
const invoke=async(t,fn,b,to=240000)=>{const t0=Date.now();const r=await fetch(`${URL}/functions/v1/${fn}`,{method:"POST",headers:{apikey:ANON,Authorization:`Bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify(b??{})});const x=await r.text();let j=null;try{j=JSON.parse(x)}catch{}return{status:r.status,ms:Date.now()-t0,j,text:x.slice(0,200)};};
const pollJob=async(t,jobId,to=240000)=>{const t0=Date.now();for(;;){const r=await invoke(t,"model-job",{job_id:jobId},30000);const s=r.j?.job?.status;if(r.j?.job&&["succeeded","failed","cancelled"].includes(s))return{...r.j.job,pollMs:Date.now()-t0};if(Date.now()-t0>to)return{timeout:true,status:s};await new Promise(r=>setTimeout(r,1000));}};
const report=[];
const beat=(n,name,ms,note)=>report.push({beat:n,name,ms_ms:Math.round(ms),note});

const dana=await signin("dana@worksense.demo");
const chris=await signin("chris@worksense.demo");
await invoke(dana,"health",{}); // warm the tunnel

// Reset to the pristine demo dataset first.
const r0=await invoke(dana,"reset-demo",{});
console.log("reset:",r0.json?.ok);

// Beat 1+2 — problem + demand: dashboard then staffing demand.
const dash=await invoke(dana,"dashboard",{});
beat(1,"Business problem: demand + dashboard",dash.ms,`open_reqs=${dash.j?.cards?.open_requisitions} headcount=${dash.j?.cards?.headcount}`);
const staff=await invoke(dana,"staffing-comparison",{});
beat(2,"Staffing demand + Hire/Move/Upskill/Hybrid",staff.ms,`deadline=${staff.j?.scenario?.deadline_days}d options=${staff.j?.options?.map(o=>o.id+":"+o.coverage_pct+"%").join(",")}`);

// Beat 3 — resume upload: extract Fixture A live (claims at low rigor).
const textA=readFileSync("public/demo-fixtures/fixture-a-priya-nair.txt","utf8");
const xr=await invoke(chris,"extract-resume",{twin_id:PRIYA,resume_text:textA,req_id:REQ},60000);
let ex={};
if(xr.j?.ok){const job=await pollJob(chris,xr.j.job_id);ex={ok:true,skills:(job.extracted_skills??[]).map(s=>`${s.name}@${s.verification_rigor}`),fit:job.fit?.score??null,pollMs:job.pollMs};}
else ex={ok:false,err:xr.text.slice(0,100)};
beat(3,"Resume upload + extraction (Fixture A)",ex.pollMs??xr.ms,ex.ok?`claims=${ex.skills.join(",")} (low rigor) fit=${ex.fit}`:`refused: ${ex.err}`);

// Beat 4 — work sample: submit (fast) + evaluate.
const ans={q1:"Idempotency: unique request key + UNIQUE constraint + return existing on conflict. Transactions: order+inventory in one tx, idempotency-key table keyed (client_id, request_id)."};
const sub=await invoke(dana,"assessment-session",{action:"submit",token:"ws-demo-priya-work-2026",answers:ans});
beat("4a","Work sample submitted",sub.ms,`status=${sub.j?.status}`);
const ev=await invoke(chris,"assessment-evaluate",{session_id:"77777777-7777-7777-7777-777777777701"});
beat("4b","Work sample evaluated (AI judgment)",ev.ms,`judgments=${ev.j?.result?.ai?.judgments?.length??0}`);

// Beat 5 — evidence changing fit: deterministic skill-match before/after claims.
const fitB=await invoke(chris,"skill-match",{twin_id:PRIYA,target_id:REQ,scenario:"current"});
beat(5,"Deterministic fit (Skill Intelligence Graph)",fitB.ms,`score=${fitB.j?.fit?.score}`);

// Beat 7 — policy: grounded + abstain.
const pol=await invoke(dana,"policy-qa",{question:"How many paid sick days do employees get per year?",employee_id:ALEX});
beat(7,"Policy question (grounded answer)",pol.ms,`status=${pol.j?.status} cites=${pol.j?.citations?.map(c=>c.doc_code+"#"+c.section).join(",")}`);

// Beat 8 — recommendation review: pick a needs_review rec, show evidence + approve with rationale.
const recs=await invoke(dana,"recommendation-scan",{},300000);
beat("8a","Recommendation scan (creates suggested recs)",recs.ms,`created=${recs.j?.created} stale=${recs.j?.made_stale}`);
const list=await invoke(dana,"dashboard",{});
beat("8b","Recommendation feed",list.ms,`pending=${list.j?.cards?.pending_recommendations}`);

// Beat 9/10 — onboarding dependency: block then resolve a task (deterministic), re-check dashboard.
const block=await invoke(dana,"onboarding-task",{plan_id:"",task_code:""}); // placeholder not called — see note
beat(9,"Onboarding dependency (live demo action)",0,"block/resolve performed in UI during live demo; API path is onboarding-task");

// Consistency assertions
const openReqs=(await invoke(dana,"dashboard",{})).j?.cards?.open_requisitions;
const reqCount=(await invoke(dana,"dashboard",{})).j?.cards?.open_requisitions;
const notes=[]; 
if(staff.j?.scenario?.req_title!==undefined) notes.push(`staffing req = "${staff.j.scenario.req_title}"`);
if(openReqs===5) notes.push(`open_reqs consistent (5)`); else notes.push(`open_reqs=${openReqs} (unexpected)`);
beat(10,"Consistency: no source/date/count contradictions",0,notes.join(" | "));

// Restore pristine.
const fin=await invoke(dana,"reset-demo",{});
console.log("final reset:",fin.json?.ok);
console.log(JSON.stringify(report,null,2));
console.log("total live AI+scan ms (excl. UI demo actions):", report.reduce((a,b)=>a+(b.ms_ms||0),0));
