import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { buildOnboardingQueue, type QueueOwnerRole, type OnboardingQueueResult } from "../_shared/onboarding-queue.ts";

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
    .select("id, role, email, org_id, manager_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  const role: QueueOwnerRole =
    caller.role === "employee"
      ? "employee"
      : caller.role === "manager"
        ? "manager"
        : caller.role === "it_security"
          ? "it_security"
          : "hr";

  const { data: planRows } = await supabase
    .from("onboarding_plans")
    .select("id, twin_id, version, status, start_date, readiness, manager_approval, hr_approval, org_id")
    .eq("org_id", caller.org_id)
    .order("version", { ascending: false });

  // Latest plan per twin.
  const byTwin = new Map<string, (typeof planRows)[number]>();
  for (const p of (planRows ?? []) as (typeof planRows)[number][]) {
    if (!byTwin.has(p.twin_id)) byTwin.set(p.twin_id, p);
  }

  const twinIds = [...byTwin.keys()];
  const { data: twinRows } = twinIds.length > 0
    ? await supabase.from("digital_twins").select("id, name, job_title, manager_id, role, org_id").in("id", twinIds)
    : { data: [] as never[] };
  const twins = (twinRows ?? []) as { id: string; name: string; job_title: string | null; manager_id: string | null; role: string; org_id: string }[];

  const employees = twins.filter((t) => t.role === "employee" && t.org_id === caller.org_id);

  // Scope per role: employee -> self; manager -> direct reports; hr/it -> all.
  let scoped = employees;
  if (role === "employee") scoped = employees.filter((t) => t.id === caller.id);
  else if (role === "manager") scoped = employees.filter((t) => t.manager_id === caller.id);

  const journeys = [];
  for (const emp of scoped) {
    const plan = byTwin.get(emp.id);
    if (!plan || plan.status === "superseded") continue;
    const { data: taskRows } = await supabase
      .from("onboarding_tasks")
      .select("task_code, title, task_type, owner_role, state, due_date, topological_level, depends_on, blockers")
      .eq("plan_id", plan.id);
    journeys.push({
      plan: {
        id: plan.id,
        twin_id: plan.twin_id,
        version: plan.version,
        status: plan.status,
        start_date: plan.start_date,
        readiness: plan.readiness ?? {},
        manager_approval: plan.manager_approval as { at?: string } | null,
        hr_approval: plan.hr_approval as { at?: string } | null,
      },
      employee: emp,
      tasks: ((taskRows ?? []) as { task_code: string; title: string; task_type: string; owner_role: string; state: string; due_date: string | null; topological_level: number; depends_on: string[]; blockers: { status: string; at: string }[] }[]).map((t) => ({
        ...t,
        blockers: (t.blockers ?? []) as { status: string; at: string }[],
      })),
    });
  }

  const result = buildOnboardingQueue({ role, journeys, now: new Date().toISOString() });
  return json(result satisfies OnboardingQueueResult);
});
