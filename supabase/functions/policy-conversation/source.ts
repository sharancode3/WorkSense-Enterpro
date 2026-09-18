// Batch G: persistent, private policy Q&A conversations.
// Ownership is enforced server-side in every action — a caller can only list,
// read, save into, or link escalations to conversations where
// owner_twin_id == caller.id. No cross-user path exists. Saves are idempotent
// on (conversation_id, request_id): retrying the same request never duplicates
// messages. The assistant row carries the full validated answer (citations,
// retrieval, computed facts, employee context) and an optional escalation link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Supabase = ReturnType<typeof createClient>;

async function ownedConversation(supabase: Supabase, orgId: string, ownerId: string, conversationId: string) {
  if (!conversationId) return null;
  const { data } = await supabase
    .from("policy_conversations")
    .select("id, org_id, owner_twin_id, title, created_at, updated_at")
    .eq("org_id", orgId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!data || data.owner_twin_id !== ownerId) return null;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id, name")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? "list");

  // ---- list my conversations (with last-message preview) ----------------------
  if (action === "list") {
    const { data } = await supabase
      .from("policy_conversations")
      .select("id, org_id, owner_twin_id, title, created_at, updated_at")
      .eq("org_id", caller.org_id)
      .eq("owner_twin_id", caller.id)
      .order("updated_at", { ascending: false })
      .limit(30);
    const convIds = (data ?? []).map((c) => c.id);
    const { data: msgs } = convIds.length > 0
      ? await supabase
          .from("policy_messages")
          .select("conversation_id, role, question, answer, escalation_id, created_at")
          .in("conversation_id", convIds)
          .order("created_at", { ascending: false })
      : { data: [] as never[] };
    const lastByConv = new Map<string, typeof msgs[number]>();
    for (const m of msgs ?? []) if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);
    const conversations = (data ?? []).map((c) => ({ ...c, last_message: lastByConv.get(c.id) ?? null }));
    return json({ ok: true, conversations });
  }

  // ---- messages of one owned conversation -------------------------------------
  if (action === "messages") {
    const conversationId = String(body.conversation_id ?? "").trim();
    const conv = await ownedConversation(supabase, caller.org_id, caller.id, conversationId);
    if (!conv) return json({ error: "NOT_FOUND" }, 404);
    const { data } = await supabase
      .from("policy_messages")
      .select("id, conversation_id, role, question, answer, escalation_id, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    return json({ ok: true, conversation: conv, messages: data ?? [] });
  }

  // ---- save a question/answer turn (idempotent on request_id) -----------------
  if (action === "save") {
    const question = String(body.question ?? "").trim();
    const requestId = String(body.request_id ?? "").trim();
    const answer = (body.answer ?? null) as Record<string, unknown> | null;
    if (!question) return json({ error: "VALIDATION_ERROR", message: "question is required." }, 400);
    if (!requestId) return json({ error: "VALIDATION_ERROR", message: "request_id is required for retry-safe persistence." }, 400);
    if (!answer) return json({ error: "VALIDATION_ERROR", message: "answer is required." }, 400);

    let conversationId = String(body.conversation_id ?? "").trim();
    if (conversationId) {
      const conv = await ownedConversation(supabase, caller.org_id, caller.id, conversationId);
      if (!conv) return json({ error: "NOT_FOUND" }, 404);
    } else {
      const title = question.length > 80 ? `${question.slice(0, 80)}…` : question;
      const { data: created, error: cErr } = await supabase
        .from("policy_conversations")
        .insert({ org_id: caller.org_id, owner_twin_id: caller.id, title })
        .select("id")
        .single();
      if (cErr) return json({ error: "INTERNAL", message: cErr.message }, 500);
      conversationId = created.id;
    }

    const now = new Date().toISOString();
    const userReq = `u:${requestId}`;
    const asstReq = `a:${requestId}`;
    // Upsert on (conversation_id, request_id): a retried save updates in place
    // instead of inserting duplicates.
    const { error: uErr } = await supabase
      .from("policy_messages")
      .upsert(
        { conversation_id: conversationId, org_id: caller.org_id, role: "user", question, request_id: userReq },
        { onConflict: "conversation_id,request_id" }
      );
    if (uErr) return json({ error: "INTERNAL", message: uErr.message }, 500);
    const { data: asst, error: aErr } = await supabase
      .from("policy_messages")
      .upsert(
        { conversation_id: conversationId, org_id: caller.org_id, role: "assistant", question: null, answer, request_id: asstReq },
        { onConflict: "conversation_id,request_id" }
      )
      .select("id")
      .single();
    if (aErr) return json({ error: "INTERNAL", message: aErr.message }, 500);

    await supabase.from("policy_conversations").update({ updated_at: now }).eq("id", conversationId);
    return json({ ok: true, conversation_id: conversationId, message_id: asst.id, created: true });
  }

  // ---- bind an escalation to the assistant message of a request ---------------
  if (action === "link-escalation") {
    const conversationId = String(body.conversation_id ?? "").trim();
    const requestId = String(body.request_id ?? "").trim();
    const escalationId = String(body.escalation_id ?? "").trim();
    if (!conversationId || !requestId || !escalationId) {
      return json({ error: "VALIDATION_ERROR", message: "conversation_id, request_id and escalation_id are required." }, 400);
    }
    const conv = await ownedConversation(supabase, caller.org_id, caller.id, conversationId);
    if (!conv) return json({ error: "NOT_FOUND" }, 404);
    const { data: esc } = await supabase
      .from("policy_escalations")
      .select("id")
      .eq("org_id", caller.org_id)
      .eq("id", escalationId)
      .maybeSingle();
    if (!esc) return json({ error: "NOT_FOUND", message: "Escalation not found in this organization." }, 404);
    const { data, error } = await supabase
      .from("policy_messages")
      .update({ escalation_id: escalationId })
      .eq("conversation_id", conversationId)
      .eq("request_id", `a:${requestId}`)
      .select("id, escalation_id")
      .maybeSingle();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    if (!data) return json({ error: "NOT_FOUND", message: "No assistant message exists for this request." }, 404);
    return json({ ok: true, message_id: data.id, escalation_id: data.escalation_id });
  }

  return json({ error: "VALIDATION_ERROR", message: `Unknown action: ${action}` }, 400);
});
