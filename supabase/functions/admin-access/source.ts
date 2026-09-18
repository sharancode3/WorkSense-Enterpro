import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Roles the admin console may assign. Candidates and IT Security are not
// self-served here: candidates come through applications, IT Security is a
// fixed demo persona.
const ASSIGNABLE_ROLES = ["hr_executive", "manager", "recruiter", "employee"];
const DEMO_PASSWORD = "WorkSenseDemo!2026";

async function appendAudit(supabase, orgId: string, actorTwinId: string, action: string, target: { twinId: string; email?: string | null }, before: Record<string, unknown>, after: Record<string, unknown>, reason: string) {
  await supabase.from("admin_actions").insert({
    org_id: orgId,
    actor_twin_id: actorTwinId,
    action,
    target_twin_id: target.twinId,
    target_email: target.email ?? null,
    before_data: before,
    after_data: after,
    reason,
  });
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
    .select("id, role, org_id, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);
  if (caller.role !== "hr_executive") {
    return json({ error: "FORBIDDEN", message: "Administrator access required." }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? "");
  const reason = String(body.reason ?? "").trim();

  // ---- invite ---------------------------------------------------------------
  if (action === "invite") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "");
    const name = String(body.name ?? "").trim() || email.split("@")[0];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "VALIDATION_ERROR", message: "A valid email is required." }, 400);
    if (!ASSIGNABLE_ROLES.includes(role)) return json({ error: "VALIDATION_ERROR", message: `Role must be one of ${ASSIGNABLE_ROLES.join(", ")}.` }, 400);

    const { data: createdUser, error: userErr } = await supabase.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { name, is_demo: true },
    });
    if (userErr) return json({ error: "CONFLICT", message: `Could not create the account: ${userErr.message}` }, 409);
    const authUserId = createdUser.user.id;

    // The auth signup trigger auto-creates an employee twin — elevate it to the
    // invited role and bind it to the caller's org.
    const { data: auto } = await supabase
      .from("digital_twins")
      .select("id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    const payload = {
      org_id: caller.org_id,
      auth_user_id: authUserId,
      name,
      email,
      role,
      status: "active" as const,
      department: "General",
      job_title: role === "manager" ? "People Manager" : role === "recruiter" ? "Recruiter" : "Member",
    };
    if (auto) {
      const { error: upErr } = await supabase.from("digital_twins").update(payload).eq("id", auto.id);
      if (upErr) return json({ error: "INTERNAL", message: upErr.message }, 500);
      await appendAudit(supabase, caller.org_id, caller.id, "invite", { twinId: auto.id, email }, {}, { role, status: "active" }, reason || "Invited by administrator.");
      return json({ ok: true, twin_id: auto.id, role, email });
    }
    const { data: inserted, error: insErr } = await supabase
      .from("digital_twins")
      .insert(payload)
      .select("id")
      .single();
    if (insErr) return json({ error: "INTERNAL", message: insErr.message }, 500);
    await appendAudit(supabase, caller.org_id, caller.id, "invite", { twinId: inserted.id, email }, {}, { role, status: "active" }, reason || "Invited by administrator.");
    return json({ ok: true, twin_id: inserted.id, role, email });
  }

  // ---- target-based actions -------------------------------------------------
  const targetTwinId = String(body.target_twin_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(targetTwinId)) return json({ error: "VALIDATION_ERROR", message: "target_twin_id is required." }, 400);
  if (reason.length < 5) return json({ error: "VALIDATION_ERROR", message: "A rationale of at least 5 characters is required for governance." }, 400);

  const { data: target } = await supabase
    .from("digital_twins")
    .select("id, role, status, org_id, email, name")
    .eq("id", targetTwinId)
    .maybeSingle();
  if (!target || target.org_id !== caller.org_id) return json({ error: "NOT_FOUND", message: "Member not found in this organization." }, 404);

  if (action === "update_role") {
    const role = String(body.role ?? "");
    if (!ASSIGNABLE_ROLES.includes(role)) return json({ error: "VALIDATION_ERROR", message: `Role must be one of ${ASSIGNABLE_ROLES.join(", ")}.` }, 400);
    if (target.id === caller.id && role !== "hr_executive") {
      return json({ error: "FORBIDDEN", message: "You cannot demote yourself out of the administrator role." }, 403);
    }
    const { error: upErr } = await supabase.from("digital_twins").update({ role }).eq("id", target.id);
    if (upErr) return json({ error: "INTERNAL", message: upErr.message }, 500);
    await appendAudit(supabase, caller.org_id, caller.id, "update_role", { twinId: target.id, email: target.email }, { role: target.role }, { role }, reason);
    return json({ ok: true, twin_id: target.id, before: { role: target.role }, after: { role } });
  }

  if (action === "suspend") {
    if (target.id === caller.id) return json({ error: "FORBIDDEN", message: "You cannot suspend your own account." }, 403);
    if (target.status === "suspended") return json({ error: "CONFLICT", message: "Account is already suspended." }, 409);
    const { error: upErr } = await supabase.from("digital_twins").update({ status: "suspended" }).eq("id", target.id);
    if (upErr) return json({ error: "INTERNAL", message: upErr.message }, 500);
    await appendAudit(supabase, caller.org_id, caller.id, "suspend", { twinId: target.id, email: target.email }, { status: target.status }, { status: "suspended" }, reason);
    return json({ ok: true, twin_id: target.id, status: "suspended" });
  }

  if (action === "reactivate") {
    if (target.status !== "suspended") return json({ error: "CONFLICT", message: "Account is not suspended." }, 409);
    const { error: upErr } = await supabase.from("digital_twins").update({ status: "active" }).eq("id", target.id);
    if (upErr) return json({ error: "INTERNAL", message: upErr.message }, 500);
    await appendAudit(supabase, caller.org_id, caller.id, "reactivate", { twinId: target.id, email: target.email }, { status: "suspended" }, { status: "active" }, reason);
    return json({ ok: true, twin_id: target.id, status: "active" });
  }

  return json({ error: "VALIDATION_ERROR", message: "Unknown action." }, 400);
});
