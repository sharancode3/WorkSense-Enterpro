import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ROLE_GATE = ["hr_executive", "hr_partner", "manager"];

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
  if (!caller || !ROLE_GATE.includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Workforce review access required (HR or manager)." }, 403);
  }

  let body: { twin_id?: string; action?: string; reason?: string; follow_up_at?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const twinId = (body.twin_id ?? "").trim();
  const action = body.action ?? "";
  const reason = (body.reason ?? "").trim();
  const followUpAt = body.follow_up_at ? new Date(body.follow_up_at).toISOString() : null;

  if (!twinId || !["acknowledged", "dismissed", "deferred"].includes(action)) {
    return json({ error: "VALIDATION_ERROR", message: "twin_id and action (acknowledged|dismissed|deferred) are required." }, 400);
  }
  if (action !== "acknowledged" && !reason) {
    return json({ error: "VALIDATION_ERROR", message: `A reason is required to ${action} a case — decisions on people always carry a rationale.` }, 400);
  }
  if (action === "deferred" && !followUpAt) {
    return json({ error: "VALIDATION_ERROR", message: "A follow-up date is required when deferring a case." }, 400);
  }
  if (action === "deferred" && new Date(followUpAt!).getTime() < Date.now()) {
    return json({ error: "VALIDATION_ERROR", message: "The follow-up date must be in the future." }, 400);
  }

  const { data: twin } = await supabase
    .from("digital_twins")
    .select("id, org_id, role, name, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (!twin) return json({ error: "NOT_FOUND" }, 404);

  let allowed = false;
  if (["hr_executive", "hr_partner"].includes(caller.role)) allowed = twin.org_id === caller.org_id;
  else if (caller.role === "manager") allowed = twin.id === caller.id || (await isTeamMember(supabase, caller.id, twin.id));
  if (!allowed) return json({ error: "FORBIDDEN", message: "This case is not in your review scope." }, 403);

  // Resolve the latest stored case for this twin (the case being acted on).
  const { data: latestCase } = await supabase
    .from("workforce_review_cases")
    .select("id")
    .eq("org_id", caller.org_id)
    .eq("twin_id", twinId)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: row, error: insErr } = await supabase
    .from("review_case_actions")
    .insert({
      org_id: caller.org_id,
      case_id: latestCase?.id ?? null,
      twin_id: twinId,
      action,
      reason,
      follow_up_at: followUpAt,
      acted_by: caller.id,
    })
    .select("*")
    .single();
  if (insErr) return json({ error: "INTERNAL", message: insErr.message }, 500);

  const now = new Date().toISOString();
  await supabase
    .from("digital_twins")
    .update({
      audit_events: [
        ...(twin.audit_events ?? []),
        { actor: caller.email ?? uid, action: `review_case_${action}`, note: `Review case ${action} with reason: ${reason.slice(0, 300)}${followUpAt ? ` (follow up ${followUpAt.slice(0, 10)})` : ""}.`, timestamp: now },
      ],
    })
    .eq("id", twinId);

  return json({
    ok: true,
    action: row,
    outcome_note: "This action is recorded for tracking. Any later change in observations is labeled observed-after — correlation is never claimed as causation.",
  });
});
