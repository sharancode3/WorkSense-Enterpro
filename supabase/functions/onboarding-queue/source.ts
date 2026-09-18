import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { buildOnboardingQueue, type QueueOwnerRole, type OnboardingQueueResult } from "../_shared/onboarding-queue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Batch 2 (2.1): explicit allowlist. Recruiter/candidate/unknown roles are
// rejected server-side — they must NEVER fall through to HR's org-wide view.
const ALLOWED_ROLES = new Set(["hr_executive", "hr_partner", "manager", "employee", "it_security"]);

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
    .select("id, role, email, org_id, manager_id, status")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);
  // Batch 2 (2.4): suspended accounts must not drive an org-wide operational
  // feed through a backend function. Sign-out alone is never the boundary.
  if (caller.status !== "active") {
    return json({ error: "FORBIDDEN", message: "This account is not active." }, 403);
  }
  if (!ALLOWED_ROLES.has(caller.role)) {
    return json({ error: "FORBIDDEN", message: "This role is not authorized to view the onboarding queue." }, 403);
  }

  const role: QueueOwnerRole =
    caller.role === "employee"
      ? "employee"
      : caller.role === "manager"
        ? "manager"
        : caller.role === "it_security"
          ? "it_security"
          : "hr";

  // Fetch the org roster once (service role — RLS does not apply here; the
  // scoping below is the only boundary, decided server-side).
  const { data: twinRows } = await supabase
    .from("digital_twins")
    .select("id, name, job_title, department, manager_id, role, org_id")
    .eq("org_id", caller.org_id);
  const twins = (twinRows ?? []) as { id: string; name: string; job_title: string | null; department: string | null; manager_id: string | null; role: string; org_id: string }[];

  const employees = twins.filter((t) => t.role === "employee" && t.org_id === caller.org_id);

  // Scope: employee -> self; manager -> recursive reporting subtree (org only);
  // HR -> organization employees; IT -> organization provisioning subjects.
  let scoped = employees;
  if (role === "employee") {
    scoped = employees.filter((t) => t.id === caller.id);
  } else if (role === "manager") {
    const subtree = new Set<string>([caller.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of twins) {
        if (t.manager_id && subtree.has(t.manager_id) && !subtree.has(t.id)) {
          subtree.add(t.id);
          grew = true;
        }
      }
    }
    scoped = employees.filter((t) => subtree.has(t.id));
  }

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

  const journeys = [];
  for (const emp of scoped) {
    const plan = byTwin.get(emp.id);
    if (!plan || plan.status === "superseded") continue;
    const { data: taskRows } = await supabase
      .from("onboarding_tasks")
      .select("task_code, title, task_type, owner_role, state, due_date, topological_level, depends_on, blockers, evidence_requirements")
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
      tasks: ((taskRows ?? []) as {
        task_code: string;
        title: string;
        task_type: string;
        owner_role: string;
        state: string;
        due_date: string | null;
        topological_level: number;
        depends_on: string[];
        blockers: { status: string; at: string }[];
        evidence_requirements: unknown[];
      }[]).map((t) => ({
        ...t,
        blockers: (t.blockers ?? []) as { status: string; at: string }[],
        evidence_requirements: t.evidence_requirements ?? [],
      })),
    });
  }

  const result = buildOnboardingQueue({ role, journeys, now: new Date().toISOString() });

  // Batch 2 (2.3): IT receives a MINIMAL operational projection — provisioning
  // tasks plus employee identity (name, start date, manager) — and none of the
  // HR-heavy journey fields (readiness, gates, approvals, waiting-on).
  if (role === "it_security") {
    const byId = new Map(twins.map((t) => [t.id, t]));
    const people = scoped.map((e) => {
      const plan = byTwin.get(e.id);
      const mgr = e.manager_id ? byId.get(e.manager_id) : null;
      return {
        twin_id: e.id,
        name: e.name,
        start_date: plan && plan.status !== "superseded" ? plan.start_date : null,
        manager_name: mgr?.name ?? null,
      };
    });
    return json({
      ok: true,
      role,
      journeys: [],
      provisioning: result.provisioning,
      people,
      filters: result.filters,
    } satisfies OnboardingQueueResult);
  }

  return json(result satisfies OnboardingQueueResult);
});
