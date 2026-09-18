import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { buildTasksForCategory } from "../_shared/workflow-engine.ts";

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

  let body: { rec_id?: string; action?: string; rationale?: string; request_id?: string; reviewer_feedback?: string; evidence?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const recId = (body.rec_id ?? "").trim();
  const action = (body.action ?? "").trim();
  const rationale = String(body.rationale ?? "").trim();
  const requestId = (body.request_id ?? "").trim() || crypto.randomUUID();
  if (!recId || !["dispatch", "start", "complete", "verify", "fail", "cancel", "retry"].includes(action)) {
    return json({ error: "VALIDATION_ERROR", message: "rec_id and a valid execution action are required." }, 400);
  }
  if (rationale.length < 5) {
    return json({ error: "VALIDATION_ERROR", message: "A short written rationale is required before the state can change." }, 400);
  }
  // Phase 15 (Batch A4): Verify requires accepted evidence references, bounded
  // and non-empty, so "verified" is never granted on a bare button click.
  let evidence: string[] = [];
  if (action === "verify") {
    if (!Array.isArray(body.evidence) || body.evidence.length === 0) {
      return json({ error: "VALIDATION_ERROR", message: "Outcome verification requires at least one evidence reference." }, 400);
    }
    evidence = (body.evidence as unknown[])
      .map((e) => String(e ?? "").trim())
      .filter((e) => e.length > 0)
      .slice(0, 20);
    if (evidence.length === 0) {
      return json({ error: "VALIDATION_ERROR", message: "Outcome verification requires at least one evidence reference." }, 400);
    }
  }

  const { data: rec, error: recErr } = await supabase
    .from("recommendations")
    .select("*")
    .eq("id", recId)
    .maybeSingle();
  if (recErr || !rec) return json({ error: "NOT_FOUND" }, 404);
  if (rec.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  // Execution actions are driven by the approver (HR or the manager in charge
  // of the subject). The SQL RPC remains the authoritative transition guard.
  let allowed = false;
  if (caller.role === "hr_executive") allowed = true;
  else if (caller.role === "hr_partner") allowed = true;
  else if (caller.role === "manager") {
    allowed = !rec.twin_id || rec.twin_id === caller.id || (await isTeamMember(supabase, caller.id, rec.twin_id));
  }
  if (!allowed) return json({ error: "FORBIDDEN", message: "Only HR or the responsible manager can drive execution." }, 403);

  const payload: Record<string, unknown> = {};
  // Phase 15 (Batch A4): persist accepted outcome evidence on verify.
  if (action === "verify" && evidence.length > 0) payload.evidence = evidence;

  // Dispatch: build the reviewed tasks from the deterministic templates and
  // resolve owner twins from the org roster. The RPC inserts them in the same
  // transaction as the state change — dispatch is only successful when the
  // task rows exist (unique task_code makes double-dispatch a no-op).
  if (action === "dispatch") {
    let subject: { id: string; manager_id: string | null } | null = null;
    let managerTwinId: string | null = null;
    if (rec.twin_id) {
      const { data: subj } = await supabase
        .from("digital_twins")
        .select("id, manager_id")
        .eq("id", rec.twin_id)
        .maybeSingle();
      subject = subj ?? null;
      managerTwinId = subj?.manager_id ?? null;
    }
    const { data: roster } = await supabase
      .from("digital_twins")
      .select("id, role, email")
      .eq("org_id", caller.org_id);
    const byRole = new Map<string, string>();
    for (const t of roster ?? []) {
      if (!byRole.has(t.role)) byRole.set(t.role, t.id);
    }
    const resolveOwner = (role: string): string => {
      if (role === "employee") return subject?.id ?? caller.id;
      if (role === "manager") return managerTwinId ?? caller.id;
      if (role === "hr") return byRole.get("hr_executive") ?? caller.id;
      if (role === "recruiter") return byRole.get("recruiter") ?? caller.id;
      if (role === "it_security") return byRole.get("it_security") ?? caller.id;
      if (role === "reviewer") return managerTwinId ?? byRole.get("hr_partner") ?? caller.id;
      return caller.id;
    };
    const templates = buildTasksForCategory(rec.category, subject?.id ?? null, managerTwinId);
    payload.tasks = templates.map((t) => ({
      task_code: t.task_code,
      title: t.title,
      owner_role: t.owner_role,
      owner_twin_id: resolveOwner(t.owner_role),
      instructions: t.instructions,
      resource_link: t.resource_link ?? null,
      required_evidence: t.required_evidence,
      depends_on: t.depends_on ?? [],
      outcome_measure: t.outcome_measure,
      due_days: t.due_days,
    }));
  }
  if (action === "complete") {
    payload.reviewer_feedback = body.reviewer_feedback || rationale;
  }

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
    created_tasks: result.created_tasks ?? 0,
    idempotent: result.idempotent === true,
    effect: result.effect ?? null,
  });
});
