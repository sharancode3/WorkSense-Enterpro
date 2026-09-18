import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function isTeamMember(supabase, rootTwinId: string, checkTwinId: string): Promise<boolean> {
  const { data } = await supabase.from("digital_twins").select("id, manager_id");
  const children = new Map<string, string[]>();
  for (const t of data ?? []) {
    if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
  }
  const seen = new Set<string>();
  const stack = [rootTwinId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of children.get(cur) ?? []) stack.push(c);
  }
  return seen.has(checkTwinId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, org_id, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: { rec_id?: string; action?: string; rationale?: string; request_id?: string; superseded_by?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const recId = (body.rec_id ?? "").trim();
  const action = (body.action ?? "").trim();
  const rationale = String(body.rationale ?? "").trim();
  const requestId = (body.request_id ?? "").trim() || crypto.randomUUID();
  if (!recId || !["submit", "approve", "reject", "re_review", "mark_stale"].includes(action)) {
    return json({ error: "VALIDATION_ERROR", message: "rec_id and a valid review action are required." }, 400);
  }
  if (rationale.length < 5) {
    return json({ error: "VALIDATION_ERROR", message: "A short written rationale is required before the state can change." }, 400);
  }

  const { data: rec, error: recErr } = await supabase
    .from("recommendations")
    .select("*")
    .eq("id", recId)
    .maybeSingle();
  if (recErr || !rec) return json({ error: "NOT_FOUND" }, 404);
  if (rec.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  // RBAC: the required approver (or HR Executive override) may change the
  // review state. Transitions are validated client-side here for fast errors;
  // the SQL RPC is the authoritative enforcement point.
  let allowed = false;
  const signoff = String(rec.required_signoff_role ?? "");
  if (caller.role === "hr_executive") allowed = true;
  else if (action === "submit") allowed = ["hr_executive", "hr_partner", "manager", "recruiter"].includes(caller.role);
  else if (caller.role === "hr_partner" && ["hr_executive", "hr_partner"].includes(signoff)) allowed = true;
  else if (caller.role === "manager" && (signoff === "manager" || action === "re_review" || action === "mark_stale")) {
    allowed = !rec.twin_id || rec.twin_id === caller.id || (await isTeamMember(supabase, caller.id, rec.twin_id));
  } else if (caller.role === "recruiter" && signoff === "recruiter" && (action === "approve" || action === "reject" || action === "submit")) {
    allowed = true;
  }
  if (!allowed) return json({ error: "FORBIDDEN", message: "You are not an authorized approver for this recommendation." }, 403);

  const payload: Record<string, unknown> = {};
  if (action === "mark_stale" && body.superseded_by) payload.superseded_by = body.superseded_by;
  if (action === "re_review") payload.reviewer_feedback = rationale;

  const { data: result, error: rpcErr } = await supabase.rpc("workflow_recommendation_transition", {
    p_org_id: caller.org_id,
    p_rec_id: recId,
    p_action: action,
    p_actor_twin_id: caller.id,
    p_actor_role: caller.role,
    p_reason: rationale,
    p_request_id: requestId,
    p_source_version: rec.source_hash ?? null,
    p_payload: payload,
  });
  if (rpcErr) return json({ error: "INTERNAL", message: rpcErr.message }, 500);
  if (!result?.ok) {
    const code = result?.error === "CONFLICT" ? 409 : result?.error === "NOT_FOUND" ? 404 : 400;
    return json({ error: result?.error ?? "INTERNAL", message: result?.message ?? "Transition failed" }, code);
  }

  return json({
    ok: true,
    request_id: requestId,
    prior_status: result.prior_status,
    status: result.new_status,
    idempotent: result.idempotent === true,
    effect: result.effect ?? null,
  });
});
