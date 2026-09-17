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

  let body: { task_id?: string; action?: string; rationale?: string; request_id?: string; evidence?: string[]; outcome?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const taskId = (body.task_id ?? "").trim();
  const action = (body.action ?? "").trim();
  const rationale = String(body.rationale ?? "").trim();
  const requestId = (body.request_id ?? "").trim() || crypto.randomUUID();
  if (!taskId || !["start", "complete", "block", "fail", "cancel", "retry"].includes(action)) {
    return json({ error: "VALIDATION_ERROR", message: "task_id and a valid action are required." }, 400);
  }
  if (rationale.length < 5) {
    return json({ error: "VALIDATION_ERROR", message: "A short written rationale is required before the state can change." }, 400);
  }
  if (action === "complete" && (body.evidence ?? []).length === 0) {
    return json({ error: "VALIDATION_ERROR", message: "Completing a task requires at least one evidence reference." }, 400);
  }

  const { data: task, error: taskErr } = await supabase
    .from("action_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (taskErr || !task) return json({ error: "NOT_FOUND" }, 404);
  if (task.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  // RBAC: the task owner acts on their task; HR/manager may assist. The SQL
  // RPC enforces the transition + optimistic concurrency.
  let allowed = task.owner_twin_id === caller.id;
  if (!allowed && ["hr_executive", "hr_partner"].includes(caller.role)) allowed = true;
  if (!allowed && caller.role === "manager") {
    const { data: rec } = await supabase
      .from("recommendations")
      .select("twin_id")
      .eq("id", task.recommendation_id)
      .maybeSingle();
    allowed = !rec?.twin_id || rec.twin_id === caller.id || (await isTeamMember(supabase, caller.id, rec.twin_id));
  }
  if (!allowed) return json({ error: "FORBIDDEN", message: "Only the task owner (or HR/manager) can act on this task." }, 403);

  const { data: result, error: rpcErr } = await supabase.rpc("workflow_action_task_transition", {
    p_org_id: caller.org_id,
    p_task_id: taskId,
    p_action: action,
    p_actor_twin_id: caller.id,
    p_actor_role: caller.role,
    p_reason: rationale,
    p_request_id: requestId,
    p_evidence: body.evidence ?? [],
    p_outcome: body.outcome ?? {},
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
    recommendation_status: result.rec_update ?? null,
    idempotent: result.idempotent === true,
  });
});
