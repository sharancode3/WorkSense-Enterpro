// Batch G verification (persistent private policy conversations):
// - conversations persist and list owner-scoped with a last-message preview
// - messages keep the full answer (citations preserved after round-trip)
// - retry with the same request_id does NOT duplicate rows (dedup)
// - escalation link is bound to the assistant message
// - no cross-user leaks: dana cannot read alex's conversation (function 404)
//   and RLS hides dana's rows from alex's REST reads
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
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${t}` } });
  return r.ok ? await r.json() : null;
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
};

const dana = await signin("dana@worksense.demo");
await invoke(dana, "reset-demo", {});

// ---- dana asks + saves a turn ------------------------------------------------
const q = "How many days of annual leave do I get and how much can I carry over?";
const answer = await invoke(dana, "policy-qa", { question: q });
check("G policy-qa answers", answer.status === 200 && answer.j?.status, `status=${answer.j?.status}`);

const REQ = "req-dana-1";
const save1 = await invoke(dana, "policy-conversation", { action: "save", question: q, answer: answer.j, request_id: REQ });
const convId = save1.j?.conversation_id;
check("G save creates a conversation", save1.status === 200 && Boolean(convId), `conv=${convId?.slice(0, 8)}`);

const list1 = await invoke(dana, "policy-conversation", { action: "list" });
check("G list returns the owner's conversation with preview", Array.isArray(list1.j?.conversations) && list1.j.conversations.length === 1 && list1.j.conversations[0].last_message?.role === "assistant", `count=${list1.j?.conversations?.length}`);

const msgs1 = await invoke(dana, "policy-conversation", { action: "messages", conversation_id: convId });
check("G messages = user + assistant with full answer", Array.isArray(msgs1.j?.messages) && msgs1.j.messages.length === 2 && msgs1.j.messages.some((m) => m.role === "assistant" && m.answer?.status), `count=${msgs1.j?.messages?.length}`);
const asstMsg = msgs1.j?.messages?.find((m) => m.role === "assistant");
check("G citations survive the round-trip", Array.isArray(asstMsg?.answer?.citations) && asstMsg.answer.citations.length > 0, `citations=${asstMsg?.answer?.citations?.length}`);

// ---- retry dedup: same request_id twice -> no extra rows ---------------------
await invoke(dana, "policy-conversation", { action: "save", question: q, answer: answer.j, request_id: REQ, conversation_id: convId });
const msgs2 = await invoke(dana, "policy-conversation", { action: "messages", conversation_id: convId });
check("G retry with the same request_id does not duplicate", msgs2.j?.messages?.length === 2, `count=${msgs2.j?.messages?.length}`);
const list2 = await invoke(dana, "policy-conversation", { action: "list" });
check("G retry does not create a second conversation", list2.j?.conversations?.length === 1, `count=${list2.j?.conversations?.length}`);

// ---- escalation bound to the assistant message --------------------------------
const esc = await invoke(dana, "escalate", { question: q });
check("G escalation created", esc.status === 200 && Boolean(esc.j?.escalation_id), `esc=${esc.j?.escalation_id?.slice(0, 8)}`);
const link = await invoke(dana, "policy-conversation", { action: "link-escalation", conversation_id: convId, request_id: REQ, escalation_id: esc.j.escalation_id });
check("G escalation linked to the assistant message", link.status === 200 && Boolean(link.j?.escalation_id), `message=${link.j?.message_id?.slice(0, 8)}`);
const msgs3 = await invoke(dana, "policy-conversation", { action: "messages", conversation_id: convId });
const linked = msgs3.j?.messages?.find((m) => m.role === "assistant");
check("G linked escalation is visible in history", linked?.escalation_id === esc.j.escalation_id, `on msg=${linked?.id?.slice(0, 8)}`);

// ---- cross-user isolation ------------------------------------------------------
const alex = await signin("alex@worksense.demo");
const alexList = await invoke(alex, "policy-conversation", { action: "list" });
check("G alex has no conversations yet (dana's are hidden)", Array.isArray(alexList.j?.conversations) && alexList.j.conversations.length === 0, `count=${alexList.j?.conversations?.length}`);

const alexAsk = await invoke(alex, "policy-qa", { question: "Can I work fully remote with approval?" });
const alexSave = await invoke(alex, "policy-conversation", { action: "save", question: "Can I work fully remote with approval?", answer: alexAsk.j, request_id: "req-alex-1" });
const alexConvId = alexSave.j?.conversation_id;
check("G alex saves her own conversation", Boolean(alexConvId) && alexConvId !== convId, `alex=${alexConvId?.slice(0, 8)}`);

const alexList2 = await invoke(alex, "policy-conversation", { action: "list" });
check("G alex's list contains ONLY her conversation", alexList2.j?.conversations?.length === 1 && alexList2.j.conversations[0].id === alexConvId, `count=${alexList2.j?.conversations?.length}`);

const cross = await invoke(dana, "policy-conversation", { action: "messages", conversation_id: alexConvId });
check("G function blocks reading another owner's conversation", cross.status === 404, `status=${cross.status}`);
const crossBack = await invoke(alex, "policy-conversation", { action: "messages", conversation_id: convId });
check("G function blocks the reverse direction too", crossBack.status === 404, `status=${crossBack.status}`);

const rlsRows = await restGet(alex, `policy_messages?conversation_id=eq.${convId}&select=id`);
check("G RLS hides dana's messages from alex's direct reads", rlsRows !== null && Array.isArray(rlsRows) && rlsRows.length === 0, `rows=${rlsRows?.length}`);
const rlsConvs = await restGet(dana, `policy_conversations?owner_twin_id=eq.${alexConvId}&select=id`);
check("G RLS hides alex's conversation from dana (owner-scoped)", rlsConvs !== null && Array.isArray(rlsConvs) && rlsConvs.length === 0, `rows=${rlsConvs?.length}`);

await invoke(dana, "reset-demo", {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
