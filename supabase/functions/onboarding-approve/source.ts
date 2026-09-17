import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

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
  if (!uid) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !["manager", "hr_executive"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Only the employee's Manager or an HR Executive may approve." }, 403);
  }

  let body: { journey_id?: string; decision?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const journeyId = (body.journey_id ?? "").trim();
  if (!journeyId) return json({ error: "BAD_REQUEST", message: "journey_id is required." }, 400);

  const { data: journey, error: journeyErr } = await supabase
    .from("onboarding_journeys")
    .select("id, org_id, twin_id, status, plan, tasks, audit_events")
    .eq("id", journeyId)
    .maybeSingle();
  if (journeyErr || !journey) return json({ error: "NOT_FOUND", message: "Onboarding journey not found." }, 404);
  if (journey.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  const { data: employee, error: empErr } = await supabase
    .from("digital_twins")
    .select("id, name, manager_id")
    .eq("id", journey.twin_id)
    .maybeSingle();
  if (empErr || !employee) return json({ error: "NOT_FOUND" }, 404);

  // Manager must be the employee's direct manager; HR Executive may approve anyone.
  if (caller.role === "manager" && employee.manager_id !== caller.id) {
    return json({ error: "FORBIDDEN", message: "You may only approve onboarding for your direct reports." }, 403);
  }

  const plan = (journey.plan ?? {}) as { approvals?: { role: string; approved: boolean; by: string; at: string }[]; start_date?: string };
  const approvals = (plan.approvals ?? []).filter((a) => a.role !== caller.role);
  approvals.push({ role: caller.role, approved: true, by: caller.email ?? uid, at: new Date().toISOString() });

  const managerApproved = approvals.some((a) => a.role === "manager" && a.approved);
  const hrApproved = approvals.some((a) => a.role === "hr_executive" && a.approved);
  const now = new Date().toISOString();

  const audit = [
    ...(journey.audit_events ?? []),
    {
      actor: caller.email ?? uid,
      action: caller.role === "manager" ? "approved_by_manager" : "approved_by_hr",
      note: `${employee.name}'s onboarding plan approved by ${caller.role === "manager" ? "Manager" : "HR Executive"}.`,
      timestamp: now,
    },
  ];

  const nextStatus = managerApproved && hrApproved ? "active" : "pending";
  if (nextStatus === "active") {
    audit.push({ actor: "system", action: "plan_activated", note: `Both approvals received — plan for ${employee.name} is active.`, timestamp: now });
  }

  await supabase
    .from("onboarding_journeys")
    .update({ status: nextStatus, plan: { ...plan, approvals }, audit_events: audit })
    .eq("id", journeyId);

  return json({ ok: true, status: nextStatus, approvals, manager_approved: managerApproved, hr_approved: hrApproved });
});
