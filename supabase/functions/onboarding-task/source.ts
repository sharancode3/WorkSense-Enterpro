import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { schedulePlan, type ScheduledTask, type TaskInput } from "../_shared/onboarding-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function toInput(t: ScheduledTask): TaskInput {
  return {
    id: t.id,
    title: t.title,
    depends_on: t.depends_on,
    skill: t.skill,
    target_proficiency: t.target_proficiency,
    non_waivable: t.non_waivable,
    duration_days: t.duration_days,
  };
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
  if (!uid) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHORIZED" }, 401);

  let body: { journey_id?: string; task_id?: string; action?: string; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const journeyId = (body.journey_id ?? "").trim();
  const taskId = (body.task_id ?? "").trim();
  const action = body.action ?? "";
  if (!journeyId || !taskId || !["complete", "block", "resolve"].includes(action)) {
    return json({ error: "BAD_REQUEST", message: "journey_id, task_id and action (complete|block|resolve) are required." }, 400);
  }

  const { data: journey, error: journeyErr } = await supabase
    .from("onboarding_journeys")
    .select("id, org_id, twin_id, status, plan, tasks, audit_events")
    .eq("id", journeyId)
    .maybeSingle();
  if (journeyErr || !journey) return json({ error: "NOT_FOUND" }, 404);
  if (journey.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  const { data: owner, error: ownerErr } = await supabase
    .from("digital_twins")
    .select("id, name, manager_id, org_id, verified_skills")
    .eq("id", journey.twin_id)
    .maybeSingle();
  if (ownerErr || !owner) return json({ error: "NOT_FOUND" }, 404);

  // Who may act: the employee themselves, their manager, or HR.
  const isOwner = owner.id === caller.id;
  const isManager = owner.manager_id === caller.id;
  const isHR = ["hr_executive", "hr_partner"].includes(caller.role);
  if (!isOwner && !isManager && !isHR) return json({ error: "FORBIDDEN" }, 403);

  const tasks = (journey.tasks ?? []) as ScheduledTask[];
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return json({ error: "NOT_FOUND", message: "Task not found." }, 404);

  const plan = (journey.plan ?? {}) as { start_date?: string };
  const startDate = plan.start_date ?? new Date().toISOString();
  const doneIds = tasks.filter((t) => t.status === "done").map((t) => t.id);
  const skills = (owner.verified_skills ?? []) as { name: string; proficiency: number }[];
  const now = new Date().toISOString();

  let nextTasks: ScheduledTask[];
  let auditAction: string;
  let auditNote: string;

  if (action === "complete") {
    // Workflow gate: completing a task requires an ACTIVE (dual-approved) plan,
    // a task that is not waived, and all prerequisites already done.
    if (journey.status !== "active") {
      return json({ error: "PLAN_NOT_ACTIVE", message: "The plan must be approved by the Manager and HR Executive before tasks can be completed." }, 400);
    }
    if (target.waived) {
      return json({ error: "TASK_WAIVED", message: `"${target.title}" is waived by verified skill — nothing to complete.` }, 400);
    }
    const unmet = (target.depends_on ?? []).filter((d) => {
      const dep = tasks.find((t) => t.id === d);
      return !dep || dep.status !== "done";
    });
    if (unmet.length > 0) {
      return json({ error: "PREREQUISITES_NOT_MET", message: `Prerequisites not complete: ${unmet.join(", ")}.` }, 400);
    }
    nextTasks = tasks.map((t) => (t.id === taskId ? { ...t, status: "done" as const } : t));
    auditAction = "task_completed";
    auditNote = `${owner.name} completed "${target.title}".`;
  } else if (action === "block") {
    const note = String(body.note ?? "").trim() || "Blocker reported.";
    // Recompute downstream dates via the same Kahn scheduler with the new constraint.
    nextTasks = schedulePlan({
      tasks: tasks.map(toInput),
      skills,
      startDate,
      blocked: { taskId, note, reported_by: caller.email ?? uid, at: now },
      doneTaskIds: doneIds,
    });
    auditAction = "blocker_reported";
    auditNote = `${owner.name}: blocker on "${target.title}" — ${note}`;
  } else {
    nextTasks = schedulePlan({
      tasks: tasks.map(toInput),
      skills,
      startDate,
      doneTaskIds: doneIds,
    });
    // Re-apply completed statuses (schedulePlan derives fresh statuses).
    nextTasks = nextTasks.map((t) => (doneIds.includes(t.id) ? { ...t, status: "done" as const } : t));
    auditAction = "blocker_resolved";
    auditNote = `${owner.name}: blocker on "${target.title}" resolved — dates recomputed.`;
  }

  const audit = [
    ...(journey.audit_events ?? []),
    { actor: caller.email ?? uid, action: auditAction, note: auditNote, timestamp: now },
  ];

  await supabase
    .from("onboarding_journeys")
    .update({ tasks: nextTasks, audit_events: audit })
    .eq("id", journeyId);

  return json({ ok: true, action, task_id: taskId, tasks: nextTasks });
});
