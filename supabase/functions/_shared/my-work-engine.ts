// ---------------------------------------------------------------------------
// WorkSense Phase 3 — unified "My work" feed engine (deterministic, pure).
//
// Turns existing workflow records into one per-role assigned-work contract.
// It NEVER duplicates state: every item references the source workflow record
// (plan/task, recommendation, action task, application, session, review case)
// and carries a deep link to the page that owns the subject. Authorization is
// decided HERE the same way the server enforces it (task owner matrix, scoped
// review/approval visibility), so "owner" and "server authorization" agree.
// ---------------------------------------------------------------------------

export type WorkItemType =
  | "onboarding_task"
  | "provisioning_request"
  | "recommendation_task"
  | "approval_request"
  | "review_case"
  | "candidate_next_step"
  | "assessment_session"
  | "requisition_attention"
  | "data_quality_alert"
  | "policy_escalation";

export type WorkGroup = "attention" | "ready" | "waiting";

export interface WorkItem {
  id: string;
  type: WorkItemType;
  title: string;
  subject: string;
  subject_id: string;
  owner: string; // acting-role key that owns resolution (e.g. "it_security")
  owner_label: string;
  authorized_actions: string[]; // what the CALLER may do on the source workflow
  group: WorkGroup;
  status_label: string;
  due_at: string | null;
  priority_reason: string | null;
  blocker: string | null;
  source: { workflow: string; version: number | null; ref_id: string };
  deep_link: string;
}

export interface MyWorkSummary {
  attention: number;
  ready: number;
  waiting: number;
}

export interface MyWorkResult {
  ok: true;
  role: string;
  summary: MyWorkSummary;
  items: WorkItem[];
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Input shapes (the function loads these rows; the engine stays pure)
// ---------------------------------------------------------------------------

export interface TwinRow {
  id: string;
  name: string;
  role: string;
  status: string;
  manager_id: string | null;
}

export interface PlanRow {
  id: string;
  twin_id: string;
  version: number;
  status: string;
}

export interface TaskRow {
  plan_id: string;
  twin_id: string;
  task_code: string;
  title: string;
  task_type: string;
  owner_role: string;
  state: string;
  due_date: string | null;
  blockers?: { id?: string; note?: string; status?: string }[] | null;
}

export interface RecommendationRow2 {
  id: string;
  twin_id: string | null;
  category: string;
  urgency: string;
  status: string;
  required_signoff_role: string | null;
  version: number;
}

export interface ActionTaskRow2 {
  id: string;
  recommendation_id: string | null;
  owner_twin_id: string;
  owner_role: string;
  title: string;
  status: string;
  due_at: string | null;
}

export interface ApplicationRow {
  candidate_twin_id: string;
  requisition_id: string;
  stage: string;
  applied_at: string;
}

export interface RequisitionRow2 {
  id: string;
  title: string;
  department: string;
  status: string;
}

export interface SessionRow {
  id: string;
  twin_id: string;
  session_type: string;
  status: string;
  expires_at: string | null;
}

export interface ReviewCaseRow2 {
  twin_id: string;
  name: string;
  index: number;
  priority: string;
}

export interface MyWorkInputs {
  caller: { id: string; role: string; org_id: string | null };
  twins: TwinRow[];
  plans: PlanRow[]; // latest non-superseded per twin
  tasks: TaskRow[];
  recommendations: RecommendationRow2[];
  actionTasks: ActionTaskRow2[];
  applications: ApplicationRow[];
  requisitions: RequisitionRow2[];
  sessions: SessionRow[];
  reviewCases: ReviewCaseRow2[]; // precomputed (engine/observations) for scoped twins
  unverifiedClaims: number;
}

// ---------------------------------------------------------------------------
// Authorization helpers — mirror the server's owner matrix (onboarding-v2.ts)
// ---------------------------------------------------------------------------

const OWNER_LABEL: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  hr: "HR",
  it_security: "IT Security",
};

/** Can the caller ACT on a task owned by ownerRole for the subject twin? */
function canActOnTask(
  caller: { id: string; role: string },
  twin: { id: string; manager_id: string | null } | undefined,
  ownerRole: string
): boolean {
  switch (ownerRole) {
    case "employee":
      return caller.role === "employee" && caller.id === twin?.id;
    case "manager":
      return (caller.role === "manager" && caller.id === twin?.manager_id) || caller.role === "hr_executive" || caller.role === "hr_partner";
    case "hr":
      return caller.role === "hr_executive" || caller.role === "hr_partner";
    case "it_security":
      return caller.role === "it_security";
    default:
      return false;
  }
}

const STAGE_NEXT: Record<string, string> = {
  screening: "Schedule technical interview",
  technical_interview: "Schedule final round",
  final_round: "Make a decision",
};

// ---------------------------------------------------------------------------
// Item builders
// ---------------------------------------------------------------------------

function onboardingItem(
  t: TaskRow,
  twin: TwinRow | undefined,
  plan: PlanRow | undefined,
  caller: { id: string; role: string; org_id: string | null }
): WorkItem | null {
  if (t.state === "done" || t.state === "waived") return null;
  const isProvisioning = t.owner_role === "it_security";
  const canAct = canActOnTask(caller, twin, t.owner_role);
  const openBlockers = (t.blockers ?? []).filter((b) => b.status === "open");
  const blocker = openBlockers.map((b) => b.note ?? "blocker reported").join("; ") || null;

  let group: WorkGroup;
  let actions: string[];
  if (canAct && (t.state === "ready" || t.state === "in_progress")) {
    group = "ready";
    actions = ["complete"];
  } else if (canAct && (t.state === "blocked" || t.state === "failed")) {
    group = "attention";
    actions = blocker ? ["resolve_blocker", "complete"] : ["report_blocker"];
  } else {
    // Not mine to complete — either waiting on its owner, or (HR/manager
    // watching a team/org journey) an attention item that stalls the journey.
    const watcher = caller.role === "manager" || caller.role === "hr_executive" || caller.role === "hr_partner";
    group = watcher && (t.state === "blocked" || t.state === "failed") ? "attention" : "waiting";
    actions = watcher ? ["view_plan"] : [];
  }

  const title =
    t.state === "blocked" || t.state === "failed"
      ? `Blocked: ${t.title}`
      : t.state === "ready" || t.state === "in_progress"
        ? `${t.title}`
        : `${t.title} (queued)`;

  return {
    id: `${isProvisioning ? "provisioning" : "onboarding"}:${t.plan_id}:${t.task_code}`,
    type: isProvisioning ? "provisioning_request" : "onboarding_task",
    title,
    subject: twin?.name ?? "employee",
    subject_id: t.twin_id,
    owner: t.owner_role,
    owner_label: OWNER_LABEL[t.owner_role] ?? t.owner_role,
    authorized_actions: actions,
    group,
    status_label:
      group === "attention" ? "Needs attention" : group === "ready" ? "Ready for you" : `Waiting on ${OWNER_LABEL[t.owner_role] ?? t.owner_role}`,
    due_at: t.due_date ?? null,
    priority_reason: t.state === "blocked" ? "Blocked — stalls the onboarding journey" : t.state === "failed" ? "Failed — plan needs revision" : null,
    blocker,
    source: { workflow: "onboarding_plan", version: plan?.version ?? null, ref_id: t.plan_id },
    deep_link: `/onboarding?twin=${encodeURIComponent(t.twin_id)}`,
  };
}

function approvalItem(r: RecommendationRow2, twin: TwinRow | undefined, canApprove: boolean): WorkItem | null {
  if (r.status !== "needs_review" || !canApprove) return null;
  const urgent = r.urgency === "critical" || r.urgency === "high";
  return {
    id: `approval:${r.id}`,
    type: "approval_request",
    title: urgent ? `Approve: ${r.category.replace(/_/g, " ")} (${r.urgency})` : `Approve: ${r.category.replace(/_/g, " ")}`,
    subject: twin?.name ?? "team member",
    subject_id: r.twin_id ?? "",
    owner: r.required_signoff_role ?? "manager",
    owner_label: "Approval",
    authorized_actions: ["review", "approve", "reject"],
    group: "attention",
    status_label: "Needs review",
    due_at: null,
    priority_reason: urgent ? `Urgency ${r.urgency}` : null,
    blocker: null,
    source: { workflow: "recommendation", version: r.version, ref_id: r.id },
    deep_link: `/hub?rec=${encodeURIComponent(r.id)}`,
  };
}

function reviewCaseItem(c: ReviewCaseRow2): WorkItem {
  const high = c.priority === "review" || c.priority === "high" || c.index >= 60;
  return {
    id: `review:${c.twin_id}`,
    type: "review_case",
    title: high ? `Workforce review: ${c.name} (${c.index}/100)` : `Workforce check-in: ${c.name} (${c.index}/100)`,
    subject: c.name,
    subject_id: c.twin_id,
    owner: "manager",
    owner_label: "Manager",
    authorized_actions: ["review"],
    group: high ? "attention" : "waiting",
    status_label: high ? "Needs attention" : "Monitor",
    due_at: null,
    priority_reason: high ? `Review priority (index ${c.index})` : null,
    blocker: null,
    source: { workflow: "workforce_review", version: null, ref_id: c.twin_id },
    deep_link: `/workforce?twin=${encodeURIComponent(c.twin_id)}`,
  };
}

// ---------------------------------------------------------------------------
// Main builder — scope is decided here per role, never by the client
// ---------------------------------------------------------------------------

export function buildMyWork(inputs: MyWorkInputs, now = new Date().toISOString()): MyWorkResult {
  const items: WorkItem[] = [];
  const byTwin = new Map(inputs.twins.map((t) => [t.id, t]));
  const planByTwin = new Map<string, PlanRow>();
  for (const p of inputs.plans) {
    const cur = planByTwin.get(p.twin_id);
    if (!cur || p.version > cur.version) planByTwin.set(p.twin_id, p);
  }

  const teamIds = new Set<string>();
  if (inputs.caller.role === "manager") {
    const children = new Map<string, string[]>();
    for (const t of inputs.twins) {
      if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
    }
    const stack = [inputs.caller.id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (teamIds.has(cur)) continue;
      teamIds.add(cur);
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
  }

  const canApprove = ["manager", "hr_executive", "hr_partner"].includes(inputs.caller.role);

  // ---- Onboarding tasks / provisioning (employee, manager, HR, IT) ----
  if (inputs.caller.role !== "recruiter" && inputs.caller.role !== "candidate") {
    for (const t of inputs.tasks) {
      const twin = byTwin.get(t.twin_id);
      if (!twin) continue;
      if (inputs.caller.role === "employee" && t.twin_id !== inputs.caller.id) continue;
      if (inputs.caller.role === "manager" && !teamIds.has(t.twin_id)) continue;
      if (inputs.caller.role === "it_security" && t.owner_role !== "it_security") continue;
      const plan = planByTwin.get(t.twin_id);
      const item = onboardingItem(t, twin, plan, inputs.caller);
      if (item) items.push(item);
    }
  }

  // ---- Approvals (manager team / HR org) ----
  if (canApprove) {
    for (const r of inputs.recommendations) {
      if (inputs.caller.role === "manager" && !(r.twin_id && teamIds.has(r.twin_id))) continue;
      const twin = r.twin_id ? byTwin.get(r.twin_id) : undefined;
      const item = approvalItem(r, twin, true);
      if (item) items.push(item);
    }
  }

  // ---- Review cases (HR org / manager team) ----
  if (inputs.caller.role === "manager" || inputs.caller.role === "hr_executive" || inputs.caller.role === "hr_partner") {
    for (const c of inputs.reviewCases) {
      if (inputs.caller.role === "manager" && !teamIds.has(c.twin_id)) continue;
      items.push(reviewCaseItem(c));
    }
  }

  // ---- Recommendation execution tasks (owner's own action tasks) ----
  if (inputs.caller.role === "employee" || inputs.caller.role === "manager" || inputs.caller.role === "recruiter") {
    for (const a of inputs.actionTasks) {
      if (a.owner_twin_id !== inputs.caller.id) continue;
      const twin = byTwin.get(a.owner_twin_id);
      const rec = inputs.recommendations.find((r) => r.id === a.recommendation_id);
      const open = a.status === "open" || a.status === "in_progress";
      items.push({
        id: `task:${a.id}`,
        type: "recommendation_task",
        title: open ? a.title : `Task ${a.status.replace(/_/g, " ")}: ${a.title}`,
        subject: twin?.name ?? "you",
        subject_id: a.owner_twin_id,
        owner: "employee",
        owner_label: "You",
        authorized_actions: open ? ["complete"] : a.status === "failed" ? ["retry"] : [],
        group: a.status === "failed" || a.status === "blocked" ? "attention" : a.status === "completed" || a.status === "cancelled" ? "waiting" : "ready",
        status_label: open ? "Ready for you" : a.status === "failed" ? "Needs attention" : a.status.replace(/_/g, " "),
        due_at: a.due_at ?? null,
        priority_reason: a.status === "failed" ? "Task failed — decide retry or cancel" : null,
        blocker: null,
        source: { workflow: "recommendation", version: rec?.version ?? null, ref_id: a.recommendation_id ?? "" },
        deep_link: "/app#action-tasks",
      });
    }
  }

  // ---- Recruiter: pipeline next steps, sessions, requisitions ----
  if (inputs.caller.role === "recruiter") {
    const reqBy = new Map(inputs.requisitions.map((r) => [r.id, r]));
    const active = inputs.applications.filter((a) => a.stage !== "selected" && a.stage !== "rejected");
    for (const a of active.sort((x, y) => x.applied_at.localeCompare(y.applied_at))) {
      const twin = byTwin.get(a.candidate_twin_id);
      const req = reqBy.get(a.requisition_id);
      const daysOld = Math.max(0, Math.floor((Date.now() - new Date(a.applied_at).getTime()) / 86400000));
      items.push({
        id: `next:${a.requisition_id}:${a.candidate_twin_id}`,
        type: "candidate_next_step",
        title: `${STAGE_NEXT[a.stage] ?? "Advance"} — ${twin?.name ?? "candidate"}`,
        subject: twin?.name ?? "candidate",
        subject_id: a.candidate_twin_id,
        owner: "recruiter",
        owner_label: "You",
        authorized_actions: ["review", "advance"],
        group: a.stage === "final_round" ? "attention" : "ready",
        status_label: a.stage === "final_round" ? "Decision pending" : `In ${a.stage.replace(/_/g, " ")}`,
        due_at: null,
        priority_reason: daysOld >= 30 ? `In ${a.stage.replace(/_/g, " ")} ${daysOld} days` : null,
        blocker: null,
        source: { workflow: "application", version: null, ref_id: a.requisition_id },
        deep_link: `/recruitment?req=${encodeURIComponent(a.requisition_id)}`,
      });
    }
    for (const s of inputs.sessions) {
      if (s.status !== "invited" && s.status !== "in_progress") continue;
      const twin = byTwin.get(s.twin_id);
      const inviteOpen = s.expires_at ? new Date(s.expires_at).getTime() > Date.now() : true;
      items.push({
        id: `session:${s.id}`,
        type: "assessment_session",
        title: `${twin?.name ?? "Candidate"} — ${s.session_type.replace(/_/g, " ")} assessment`,
        subject: twin?.name ?? "candidate",
        subject_id: s.twin_id,
        owner: "recruiter",
        owner_label: "You",
        authorized_actions: ["send_reminder", "review"],
        group: inviteOpen ? "ready" : "attention",
        status_label: inviteOpen ? "Awaiting the candidate" : "Session expired",
        due_at: s.expires_at ?? null,
        priority_reason: inviteOpen ? null : "Invitation expired — resend or close",
        blocker: null,
        source: { workflow: "candidate_session", version: null, ref_id: s.id },
        deep_link: `/recruitment`,
      });
    }
    for (const r of inputs.requisitions) {
      if (r.status !== "open") continue;
      const applicants = inputs.applications.filter((a) => a.requisition_id === r.id && a.stage !== "selected" && a.stage !== "rejected").length;
      if (applicants === 0) {
        items.push({
          id: `req:${r.id}`,
          type: "requisition_attention",
          title: `${r.title} — no candidates in pipeline`,
          subject: r.title,
          subject_id: r.id,
          owner: "recruiter",
          owner_label: "You",
          authorized_actions: ["review"],
          group: "attention",
          status_label: "Open, no pipeline",
          due_at: null,
          priority_reason: null,
          blocker: null,
          source: { workflow: "requisition", version: null, ref_id: r.id },
          deep_link: `/recruitment?req=${encodeURIComponent(r.id)}`,
        });
      }
    }
  }

  // ---- Admin: org-wide data-quality alert ----
  if (inputs.caller.role === "hr_executive" && inputs.unverifiedClaims > 0) {
    items.push({
      id: "quality:unverified-claims",
      type: "data_quality_alert",
      title: `${inputs.unverifiedClaims} skill claim${inputs.unverifiedClaims > 1 ? "s" : ""} awaiting verification`,
      subject: "Skill assertions",
      subject_id: inputs.caller.org_id ?? "",
      owner: "hr_executive",
      owner_label: "You",
      authorized_actions: ["review"],
      group: "attention",
      status_label: "Data quality",
      due_at: null,
      priority_reason: "Unverified claims must not read as verified evidence",
      blocker: null,
      source: { workflow: "skill_assertions", version: null, ref_id: inputs.caller.org_id ?? "" },
      deep_link: "/workforce/data-quality",
    });
  }

  const summary: MyWorkSummary = {
    attention: items.filter((i) => i.group === "attention").length,
    ready: items.filter((i) => i.group === "ready").length,
    waiting: items.filter((i) => i.group === "waiting").length,
  };

  return { ok: true, role: inputs.caller.role, summary, items, generated_at: now };
}
