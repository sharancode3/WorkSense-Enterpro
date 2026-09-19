import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { notifyScanAfter } from "../_shared/notify-hook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: { plan_id?: string; plan_hash?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const planId = (body.plan_id ?? "").trim();
  const submittedHash = (body.plan_hash ?? "").trim();
  if (!planId) return json({ error: "VALIDATION_ERROR", message: "plan_id is required." }, 400);

  const { data: plan, error: planErr } = await supabase
    .from("onboarding_plans")
    .select("id, org_id, twin_id, version, plan_hash, status, manager_approval, hr_approval, audit_events")
    .eq("id", planId)
    .maybeSingle();
  if (planErr || !plan) return json({ error: "NOT_FOUND", message: "Onboarding plan not found." }, 404);
  if (plan.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  // Approval is bound to the exact plan version + hash. A regenerated plan has
  // a NEW row/hash — old approvals never carry (no retained approved state).
  // Authorization is checked BEFORE the binding so callers get the true reason.
  const { data: employee, error: empErr } = await supabase
    .from("digital_twins")
    .select("id, name, manager_id")
    .eq("id", plan.twin_id)
    .maybeSingle();
  if (empErr || !employee) return json({ error: "NOT_FOUND" }, 404);

  // An employee can never approve their own journey; a manager approves only
  // their direct reports; HR Executive approves anyone (org-scoped).
  if (caller.role === "employee") {
    return json({ error: "FORBIDDEN", message: "An employee cannot approve their own onboarding plan." }, 403);
  }
  if (caller.role === "manager" && employee.manager_id !== caller.id) {
    return json({ error: "FORBIDDEN", message: "You may only approve onboarding for your direct reports." }, 403);
  }
  if (!["manager", "hr_executive"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Only the employee's Manager or an HR Executive may approve." }, 403);
  }

  if (submittedHash && submittedHash !== plan.plan_hash) {
    return json({ error: "HASH_MISMATCH", message: "This plan version was superseded — approval rejected." }, 409);
  }
  if (plan.status !== "pending_approval") {
    return json({ error: "CONFLICT", message: `Plan is '${plan.status}' — approval only valid on a pending plan.` }, 409);
  }

  if (caller.role === "manager") {
    if (plan.manager_approval && (plan.manager_approval as { at?: string }).at) {
      return json({ error: "CONFLICT", message: "Manager approval already recorded on this version." }, 409);
    }
  } else if (plan.hr_approval && (plan.hr_approval as { at?: string }).at) {
    return json({ error: "CONFLICT", message: "HR Executive approval already recorded on this version." }, 409);
  }

  const now = new Date().toISOString();
  const approvalRecord = { by: caller.email ?? uid, by_twin_id: caller.id, at: now };

  const managerApproval = caller.role === "manager" ? approvalRecord : (plan.manager_approval as typeof approvalRecord | null);
  const hrApproval = caller.role === "hr_executive" ? approvalRecord : (plan.hr_approval as typeof approvalRecord | null);
  const bothApproved = Boolean(managerApproval && hrApproval);

  const nextStatus = bothApproved ? "approved" : "pending_approval";
  const audit = [
    ...((plan.audit_events as unknown[]) ?? []),
    {
      actor: caller.email ?? uid,
      action: caller.role === "manager" ? "approved_by_manager" : "approved_by_hr",
      note: `${employee.name}'s plan v${plan.version} approved by ${caller.role === "manager" ? "Manager" : "HR Executive"}.`,
      timestamp: now,
    },
  ];
  if (bothApproved) {
    audit.push({ actor: "system", action: "plan_activated", note: `Both approvals received — plan v${plan.version} for ${employee.name} is active.`, timestamp: now });
  }

  await supabase
    .from("onboarding_plans")
    .update({ status: nextStatus, manager_approval: managerApproval, hr_approval: hrApproval, audit_events: audit })
    .eq("id", planId);

  // Authoritative transition → schedule idempotent notification generation.
  void notifyScanAfter(caller.org_id, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  return json({
    ok: true,
    plan_id: planId,
    version: plan.version,
    plan_hash: plan.plan_hash,
    status: nextStatus,
    manager_approved: Boolean(managerApproval),
    hr_approved: Boolean(hrApproval),
  });
});
