// ---------------------------------------------------------------------------
// WorkSense Phase 34 — notification / reminder / digest / analytics engine.
//
// Deterministic and pure (imports nothing; bundled into the notify-scan and
// notifications backend functions and unit-tested directly). It derives
// durable notification drafts from CANONICAL domain records — never from page
// visits — with stable deduplication keys so repeated scans are idempotent.
//
// Ethics: no efficiency scores, no rankings, no attrition inference. Workflow
// analytics separate blocked/waiting time, use medians, and exclude waiting /
// blocked items from on-time denominators. Aggregate views never expose
// private personal tasks.
// ---------------------------------------------------------------------------

export type NotifCategory =
  | "action_required"
  | "deadline"
  | "blocker"
  | "assignment"
  | "decision"
  | "status_update"
  | "security"
  | "personal_reminder";
export type NotifSeverity = "critical" | "high" | "normal" | "informational";

export interface NotifDraft {
  recipient_twin_id: string;
  category: NotifCategory;
  severity: NotifSeverity;
  type: string;
  title: string;
  body: string;
  actor_type: "system" | "user";
  actor_twin_id: string | null;
  actor_name: string | null;
  related_twin_id: string | null;
  related_name: string | null;
  source_module: string;
  source_resource_type: string;
  source_resource_id: string;
  source_version: string | null;
  source_ref_id: string | null;
  deep_link: string | null;
  action_required: boolean;
  action_label: string | null;
  deadline: string | null;
  work_item_id: string | null;
  event_id: string;
  dedup_key: string;
  rule_version: number;
  expires_at: string | null;
  /** Critical authorized incidents may bypass quiet hours; recorded here. */
  quiet_hours_exempt: boolean;
}

// ---------------------------------------------------------------------------
// Canonical row shapes (the scan function loads these; the engine stays pure).
// ---------------------------------------------------------------------------

export interface NotifTwinRow {
  id: string;
  name: string;
  role: string;
  status: string;
  manager_id: string | null;
}
export interface NotifPlanRow {
  id: string;
  twin_id: string;
  version: number;
  status: string;
  start_date: string | null;
}
export interface NotifTaskRow {
  plan_id: string;
  twin_id: string;
  task_code: string;
  title: string;
  task_type: string;
  owner_role: string;
  state: string;
  due_date: string | null;
  completion_at: string | null;
  blockers?: { id?: string; note?: string; reported_by?: string; at?: string; status?: string }[] | null;
}
export interface NotifApplicationRow {
  candidate_twin_id: string;
  requisition_id: string;
  stage: string;
  applied_at: string;
  version: number;
}
export interface NotifReqRow {
  id: string;
  title: string;
  department: string;
  status: string;
}
export interface NotifSessionRow {
  id: string;
  twin_id: string;
  session_type: string;
  status: string;
  expires_at: string | null;
}
export interface NotifAssessmentRow {
  id: string;
  twin_id: string;
  requisition_id: string | null;
  type: string;
  result: { review_required?: boolean } | null;
  reviewed_at: string | null;
}
export interface NotifRecRow {
  id: string;
  twin_id: string | null;
  category: string;
  urgency: string;
  status: string;
  version: number;
  required_signoff_role: string | null;
}
export interface NotifActionTaskRow {
  id: string;
  recommendation_id: string | null;
  owner_twin_id: string;
  owner_role: string;
  title: string;
  status: string;
  due_at: string | null;
  task_code: string | null;
  started_at: string | null;
  completed_at: string | null;
}
export interface NotifReviewCaseRow {
  twin_id: string;
  name: string;
  index: number;
  priority: string;
}
export interface NotifReviewActionRow {
  case_id: string;
  twin_id: string;
  action: string;
  acted_by: string;
  acted_at: string;
}
export interface NotifStaffingProposalRow {
  id: string;
  status: string;
  title: string | null;
}
export interface NotifPolicyDocRow {
  doc_code: string;
  title: string;
  version: number;
  effective_from: string;
}
export interface NotifEscalationRow {
  id: string;
  status: string;
  question: string;
  owner_twin_id: string | null;
  created_at: string;
}
export interface NotifAssertionRow {
  id: string;
  twin_id: string;
  review_state: string;
}
export interface NotifAdminActionRow {
  id: string;
  action: string;
  actor_twin_id: string | null;
  target_twin_id: string | null;
  created_at: string;
  reason: string | null;
}
export interface NotifPersonalRow {
  id: string;
  owner_twin_id: string;
  title: string;
  due_at: string | null;
  status: string;
  recurrence: { freq?: string } | null;
  original_due_at: string | null;
  rollover_count: number;
}
export interface NotifInstanceRow {
  id: string;
  owner_twin_id: string;
  rule_key: string;
  occurrence_date: string;
  due_at: string | null;
  title: string;
  status: string;
}
export interface NotifPrefsRow {
  twin_id: string;
  in_app: boolean;
  assignments: boolean;
  due_soon: boolean;
  overdue: boolean;
  status_updates: boolean;
  personal_reminders: boolean;
  daily_digest: boolean;
  weekly_digest: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
  working_days: number[];
}

export interface NotifInputs {
  org_id: string;
  twins: NotifTwinRow[];
  plans: NotifPlanRow[];
  tasks: NotifTaskRow[];
  applications: NotifApplicationRow[];
  requisitions: NotifReqRow[];
  sessions: NotifSessionRow[];
  assessments: NotifAssessmentRow[];
  recommendations: NotifRecRow[];
  actionTasks: NotifActionTaskRow[];
  reviewCases: NotifReviewCaseRow[];
  reviewActions: NotifReviewActionRow[];
  staffingProposals: NotifStaffingProposalRow[];
  policyDocs: NotifPolicyDocRow[];
  escalations: NotifEscalationRow[];
  assertions: NotifAssertionRow[];
  adminActions: NotifAdminActionRow[];
  personalTasks: NotifPersonalRow[];
  instances: NotifInstanceRow[];
  prefs: NotifPrefsRow[];
}

export const NOTIF_RULE_VERSION = 1;

// ---------------------------------------------------------------------------
// Stable hashing for dedup keys (FNV-1a, hex). Name is unique per bundle.
// ---------------------------------------------------------------------------
export function notifFnv(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function notifDedupKey(parts: string[]): string {
  return notifFnv(parts.join("|"));
}

// ---------------------------------------------------------------------------
// Time helpers (offset minutes = getTimezoneOffset(); UTC = local + offset).
// ---------------------------------------------------------------------------
export function notifDateKey(iso: string, tzOffsetMinutes: number): string {
  return new Date(new Date(iso).getTime() - tzOffsetMinutes * 60000).toISOString().slice(0, 10);
}
export function notifAddDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function notifIsWorkingDay(dateKey: string, workingDays: number[]): boolean {
  const dow = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return workingDays.includes(dow);
}
export function notifNextWorkingDay(dateKey: string, workingDays: number[]): string {
  let d = dateKey;
  for (let i = 0; i < 14; i++) {
    d = notifAddDays(d, 1);
    if (notifIsWorkingDay(d, workingDays)) return d;
  }
  return d;
}
export function notifMinuteOf(iso: string, tzOffsetMinutes: number): number {
  const local = new Date(new Date(iso).getTime() - tzOffsetMinutes * 60000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

// ---------------------------------------------------------------------------
// Recipient resolution helpers.
// ---------------------------------------------------------------------------
export function notifFindTwins(twins: NotifTwinRow[], role: string): NotifTwinRow[] {
  return twins.filter((t) => t.role === role && t.status === "active");
}
export function notifFirstTwin(twins: NotifTwinRow[], role: string): NotifTwinRow | null {
  return notifFindTwins(twins, role)[0] ?? null;
}
export function notifName(twins: NotifTwinRow[], id: string | null): string | null {
  if (!id) return null;
  return twins.find((t) => t.id === id)?.name ?? null;
}
export function notifTeamIds(twins: NotifTwinRow[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const t of twins) {
    if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
  }
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of children.get(cur) ?? []) stack.push(c);
  }
  return seen;
}
export function notifHrIds(twins: NotifTwinRow[]): string[] {
  return notifFindTwins(twins, "hr_executive").concat(notifFindTwins(twins, "hr_partner")).map((t) => t.id);
}

// ---------------------------------------------------------------------------
// Draft builders.
// ---------------------------------------------------------------------------

interface NotifDraftBase {
  category: NotifCategory;
  severity: NotifSeverity;
  type: string;
  title: string;
  body: string;
  actor_type?: "system" | "user";
  actor_twin_id?: string | null;
  actor_name?: string | null;
  related_twin_id?: string | null;
  related_name?: string | null;
  source_module: string;
  source_resource_type: string;
  source_resource_id: string;
  source_version?: string | null;
  source_ref_id?: string | null;
  deep_link?: string | null;
  action_required?: boolean;
  action_label?: string | null;
  deadline?: string | null;
  work_item_id?: string | null;
  event_id: string;
  expires_at?: string | null;
  quiet_hours_exempt?: boolean;
}

function notifMake(inputs: NotifInputs, recipient: string, b: NotifDraftBase): NotifDraft {
  return {
    recipient_twin_id: recipient,
    category: b.category,
    severity: b.severity,
    type: b.type,
    title: b.title,
    body: b.body,
    actor_type: b.actor_type ?? "system",
    actor_twin_id: b.actor_twin_id ?? null,
    actor_name: b.actor_name ?? null,
    related_twin_id: b.related_twin_id ?? null,
    related_name: b.related_name ?? null,
    source_module: b.source_module,
    source_resource_type: b.source_resource_type,
    source_resource_id: b.source_resource_id,
    source_version: b.source_version ?? null,
    source_ref_id: b.source_ref_id ?? null,
    deep_link: b.deep_link ?? null,
    action_required: b.action_required ?? false,
    action_label: b.action_label ?? null,
    deadline: b.deadline ?? null,
    work_item_id: b.work_item_id ?? null,
    event_id: b.event_id,
    dedup_key: notifDedupKey([b.type, b.source_resource_type, b.source_resource_id, b.source_version ?? "", recipient, String(NOTIF_RULE_VERSION)]),
    rule_version: NOTIF_RULE_VERSION,
    expires_at: b.expires_at ?? null,
    quiet_hours_exempt: b.quiet_hours_exempt ?? false,
  };
}

// ---------------------------------------------------------------------------
// Domain rules. Each reads canonical rows and returns drafts. `now`/`todayKey`
// keep the engine deterministic for tests.
// ---------------------------------------------------------------------------

export function notifRules(inputs: NotifInputs, now: string, todayKey: string): NotifDraft[] {
  const out: NotifDraft[] = [];
  const twins = inputs.twins;
  const recruiter = notifFirstTwin(twins, "recruiter");
  const itTwin = notifFirstTwin(twins, "it_security");
  const hrIds = notifHrIds(twins);
  const nameOf = (id: string | null) => notifName(twins, id);

  const push = (recipient: string, b: NotifDraftBase) => {
    if (!recipient) return;
    out.push(notifMake(inputs, recipient, b));
  };

  // ---- Recruitment ---------------------------------------------------------
  if (recruiter) {
    for (const s of inputs.sessions) {
      const cand = twins.find((t) => t.id === s.twin_id);
      const req = inputs.applications.find((a) => a.candidate_twin_id === s.twin_id);
      const reqId = req?.requisition_id ?? "";
      const link = reqId ? `/recruitment?req=${encodeURIComponent(reqId)}` : "/recruitment";
      if (s.status === "invited") {
        push(recruiter.id, {
          category: "action_required",
          severity: "normal",
          type: "assessment_invitation_pending",
          title: "Assessment invitation awaiting response",
          body: `${cand?.name ?? "A candidate"}'s ${s.session_type.replace(/_/g, " ")} invite is still open.`,
          related_twin_id: s.twin_id,
          related_name: cand?.name ?? null,
          source_module: "recruitment",
          source_resource_type: "candidate_session",
          source_resource_id: s.id,
          source_version: s.status,
          source_ref_id: reqId || null,
          deep_link: link,
          action_required: true,
          action_label: "Review invitation",
          deadline: s.expires_at,
          work_item_id: `session:${s.id}`,
          event_id: `ev:session:${s.id}`,
        });
      }
      if (s.status === "submitted") {
        push(recruiter.id, {
          category: "action_required",
          severity: "high",
          type: "assessment_awaiting_review",
          title: "Assessment awaiting review",
          body: `${cand?.name ?? "A candidate"} submitted a ${s.session_type.replace(/_/g, " ")} assessment — review it.`,
          related_twin_id: s.twin_id,
          related_name: cand?.name ?? null,
          source_module: "recruitment",
          source_resource_type: "candidate_session",
          source_resource_id: s.id,
          source_version: s.status,
          source_ref_id: reqId || null,
          deep_link: link,
          action_required: true,
          action_label: "Review assessment",
          work_item_id: `session:${s.id}`,
          event_id: `ev:session:${s.id}`,
        });
      }
    }
    for (const a of inputs.applications) {
      if (a.stage === "selected" || a.stage === "rejected") {
        const cand = twins.find((t) => t.id === a.candidate_twin_id);
        push(recruiter.id, {
          category: "decision",
          severity: "informational",
          type: "candidate_outcome",
          title: a.stage === "selected" ? "Candidate selected" : "Candidate rejected",
          body: `${cand?.name ?? "A candidate"} was ${a.stage === "selected" ? "selected" : "rejected"} for ${inputs.requisitions.find((r) => r.id === a.requisition_id)?.title ?? "the role"}.`,
          related_twin_id: a.candidate_twin_id,
          related_name: cand?.name ?? null,
          source_module: "recruitment",
          source_resource_type: "application",
          source_resource_id: a.candidate_twin_id,
          source_version: String(a.version),
          source_ref_id: a.requisition_id,
          deep_link: `/recruitment?req=${encodeURIComponent(a.requisition_id)}`,
          action_required: false,
          event_id: `ev:app:${a.candidate_twin_id}`,
        });
      }
      // Stalled beyond SLA (14 days without reaching interview).
      const ageDays = Math.floor((Date.parse(now) - Date.parse(a.applied_at)) / 86400000);
      if ((a.stage === "screening" || a.stage === "technical_interview") && ageDays >= 14) {
        push(recruiter.id, {
          category: "deadline",
          severity: "high",
          type: "application_stalled",
          title: "Application stalled beyond SLA",
          body: `${nameOf(a.candidate_twin_id) ?? "A candidate"} has been in ${a.stage.replace(/_/g, " ")} for ${ageDays} days.`,
          related_twin_id: a.candidate_twin_id,
          related_name: nameOf(a.candidate_twin_id),
          source_module: "recruitment",
          source_resource_type: "application",
          source_resource_id: a.candidate_twin_id,
          source_version: String(a.version),
          source_ref_id: a.requisition_id,
          deep_link: `/recruitment?req=${encodeURIComponent(a.requisition_id)}`,
          action_required: true,
          action_label: "Review pipeline",
          work_item_id: `next:${a.requisition_id}:${a.candidate_twin_id}`,
          event_id: `ev:stall:${a.candidate_twin_id}`,
        });
      }
    }
    for (const as of inputs.assessments) {
      if (!as.reviewed_at && as.result?.review_required === true) {
        push(recruiter.id, {
          category: "action_required",
          severity: "high",
          type: "assessment_review_required",
          title: "Assessment review required",
          body: `A ${as.type.replace(/_/g, " ")} assessment needs your review.`,
          related_twin_id: as.twin_id,
          related_name: nameOf(as.twin_id),
          source_module: "recruitment",
          source_resource_type: "assessment",
          source_resource_id: as.id,
          source_version: "unreviewed",
          source_ref_id: as.requisition_id ?? null,
          deep_link: "/recruitment",
          action_required: true,
          action_label: "Review assessment",
          event_id: `ev:assessment:${as.id}`,
        });
      }
    }
  }

  // ---- Onboarding ----------------------------------------------------------
  for (const p of inputs.plans) {
    const emp = twins.find((t) => t.id === p.twin_id);
    const empName = emp?.name ?? "Employee";
    const link = `/onboarding?twin=${encodeURIComponent(p.twin_id)}`;
    if (p.status === "pending_approval") {
      for (const hrId of hrIds) {
        push(hrId, {
          category: "action_required",
          severity: "normal",
          type: "plan_awaiting_approval",
          title: `${empName}'s onboarding plan awaits approval`,
          body: `Plan v${p.version} is pending approval.`,
          related_twin_id: p.twin_id,
          related_name: empName,
          source_module: "onboarding",
          source_resource_type: "onboarding_plan",
          source_resource_id: p.id,
          source_version: String(p.version),
          source_ref_id: p.id,
          deep_link: link,
          action_required: true,
          action_label: "Approve plan",
          event_id: `ev:plan:${p.id}`,
        });
      }
    }
    if (p.status === "approved") {
      push(p.twin_id, {
        category: "decision",
        severity: "informational",
        type: "plan_approved",
        title: "Your onboarding plan was approved",
        body: `Your onboarding plan v${p.version} is active.`,
        related_twin_id: p.twin_id,
        related_name: empName,
        source_module: "onboarding",
        source_resource_type: "onboarding_plan",
        source_resource_id: p.id,
        source_version: String(p.version),
        source_ref_id: p.id,
        deep_link: link,
        action_required: false,
        event_id: `ev:plan:${p.id}`,
      });
    }
    if (p.status === "completed") {
      push(p.twin_id, {
        category: "status_update",
        severity: "informational",
        type: "journey_completed",
        title: "Onboarding journey completed",
        body: "All owned tasks are complete. Welcome to the team.",
        related_twin_id: p.twin_id,
        related_name: empName,
        source_module: "onboarding",
        source_resource_type: "onboarding_plan",
        source_resource_id: p.id,
        source_version: String(p.version),
        source_ref_id: p.id,
        deep_link: link,
        action_required: false,
        event_id: `ev:plan:${p.id}`,
      });
    }
  }

  for (const t of inputs.tasks) {
    const emp = twins.find((x) => x.id === t.twin_id);
    const empName = emp?.name ?? "Employee";
    const link = `/onboarding?twin=${encodeURIComponent(t.twin_id)}`;
    const isProvisioning = t.owner_role === "it_security";
    const workItemId = `${isProvisioning ? "provisioning" : "onboarding"}:${t.plan_id}:${t.task_code}`;
    const openBlockers = (t.blockers ?? []).filter((b) => b.status === "open");
    const dueKey = t.due_date ? notifDateKey(t.due_date, 0) : null;

    if (openBlockers.length > 0 || t.state === "blocked") {
      const reason = openBlockers.map((b) => b.note ?? "blocker").join("; ");
      const owner = t.owner_role === "employee" ? t.twin_id : t.owner_role === "manager" ? emp?.manager_id ?? "" : t.owner_role === "it_security" ? itTwin?.id ?? "" : hrIds[0] ?? "";
      if (owner) {
        push(owner, {
          category: "blocker",
          severity: "high",
          type: "onboarding_blocked",
          title: `Blocked: ${t.title}`,
          body: `${reason || "A blocker is open"} on ${empName}'s onboarding.`,
          related_twin_id: t.twin_id,
          related_name: empName,
          source_module: "onboarding",
          source_resource_type: "onboarding_task",
          source_resource_id: `${t.plan_id}:${t.task_code}`,
          source_version: t.state,
          source_ref_id: t.plan_id,
          deep_link: link,
          action_required: true,
          action_label: "Resolve blocker",
          work_item_id: workItemId,
          event_id: `ev:task:${t.plan_id}:${t.task_code}`,
        });
      }
      // The manager of the affected employee also watches a stalled journey.
      if (emp?.manager_id && owner !== emp.manager_id) {
        push(emp.manager_id, {
          category: "blocker",
          severity: "normal",
          type: "onboarding_blocker_watch",
          title: `${empName}'s onboarding is blocked`,
          body: `${t.title} is blocked — the journey is stalled.`,
          related_twin_id: t.twin_id,
          related_name: empName,
          source_module: "onboarding",
          source_resource_type: "onboarding_task",
          source_resource_id: `${t.plan_id}:${t.task_code}`,
          source_version: t.state,
          source_ref_id: t.plan_id,
          deep_link: link,
          action_required: true,
          action_label: "View journey",
          work_item_id: workItemId,
          event_id: `ev:task:${t.plan_id}:${t.task_code}`,
        });
      }
    }

    if (t.owner_role === "employee" && (t.state === "ready" || t.state === "in_progress")) {
      push(t.twin_id, {
        category: "assignment",
        severity: dueKey === todayKey ? "high" : "normal",
        type: "task_actionable",
        title: `Ready for you: ${t.title}`,
        body: dueKey === todayKey ? "This onboarding task is due today." : "Your onboarding task is ready to act on.",
        related_twin_id: t.twin_id,
        related_name: empName,
        source_module: "onboarding",
        source_resource_type: "onboarding_task",
        source_resource_id: `${t.plan_id}:${t.task_code}`,
        source_version: t.state,
        source_ref_id: t.plan_id,
        deep_link: link,
        action_required: true,
        action_label: "Complete",
        deadline: t.due_date,
        work_item_id: workItemId,
        event_id: `ev:task:${t.plan_id}:${t.task_code}`,
      });
    }

    if (t.owner_role === "employee" && t.state !== "done" && t.due_date) {
      if (dueKey === todayKey) {
        push(t.twin_id, {
          category: "deadline",
          severity: "high",
          type: "task_due_today",
          title: `Due today: ${t.title}`,
          body: "Your onboarding task is due today.",
          related_twin_id: t.twin_id,
          related_name: empName,
          source_module: "onboarding",
          source_resource_type: "onboarding_task",
          source_resource_id: `${t.plan_id}:${t.task_code}`,
          source_version: t.state,
          source_ref_id: t.plan_id,
          deep_link: link,
          action_required: false,
          deadline: t.due_date,
          work_item_id: workItemId,
          event_id: `ev:task:${t.plan_id}:${t.task_code}`,
        });
      } else if (dueKey < todayKey) {
        push(t.twin_id, {
          category: "deadline",
          severity: "critical",
          type: "task_overdue",
          title: `Overdue: ${t.title}`,
          body: "This onboarding task is overdue and requires action.",
          related_twin_id: t.twin_id,
          related_name: empName,
          source_module: "onboarding",
          source_resource_type: "onboarding_task",
          source_resource_id: `${t.plan_id}:${t.task_code}`,
          source_version: t.state,
          source_ref_id: t.plan_id,
          deep_link: link,
          action_required: true,
          action_label: "Complete",
          deadline: t.due_date,
          work_item_id: workItemId,
          event_id: `ev:task:${t.plan_id}:${t.task_code}`,
        });
      }
    }

    if (t.owner_role === "it_security" && (t.state === "ready" || t.state === "in_progress") && itTwin) {
      push(itTwin.id, {
        category: "assignment",
        severity: "high",
        type: "provisioning_required",
        title: `Provisioning required: ${t.title}`,
        body: `${empName} needs ${t.title.toLowerCase()} to continue onboarding.`,
        related_twin_id: t.twin_id,
        related_name: empName,
        source_module: "onboarding",
        source_resource_type: "onboarding_task",
        source_resource_id: `${t.plan_id}:${t.task_code}`,
        source_version: t.state,
        source_ref_id: t.plan_id,
        deep_link: link,
        action_required: true,
        action_label: "Provision",
        deadline: t.due_date,
        work_item_id: workItemId,
        event_id: `ev:task:${t.plan_id}:${t.task_code}`,
      });
    }
  }

  // ---- Recommendations / action tasks --------------------------------------
  for (const r of inputs.recommendations) {
    const empName = nameOf(r.twin_id) ?? "A team member";
    const label = r.category.replace(/_/g, " ");
    if (r.status === "needs_review") {
      const signoffRole = r.required_signoff_role ?? "manager";
      const recipients = signoffRole === "hr_executive" || signoffRole === "hr_partner" ? hrIds : [];
      if (signoffRole === "manager" && r.twin_id) {
        const emp = twins.find((t) => t.id === r.twin_id);
        if (emp?.manager_id) recipients.push(emp.manager_id);
      }
      for (const rec of new Set(recipients)) {
        push(rec, {
          category: "action_required",
          severity: r.urgency === "critical" || r.urgency === "high" ? "high" : "normal",
          type: "recommendation_review",
          title: `Recommendation awaits review: ${label}`,
          body: `${empName}'s ${label} recommendation (v${r.version}) needs your sign-off.`,
          related_twin_id: r.twin_id,
          related_name: empName,
          source_module: "recommendations",
          source_resource_type: "recommendation",
          source_resource_id: r.id,
          source_version: String(r.version),
          source_ref_id: r.id,
          deep_link: `/hub?rec=${encodeURIComponent(r.id)}`,
          action_required: true,
          action_label: "Review recommendation",
          work_item_id: `approval:${r.id}`,
          event_id: `ev:rec:${r.id}`,
        });
      }
    }
    if (r.status === "completed" && r.twin_id) {
      push(r.twin_id, {
        category: "decision",
        severity: "informational",
        type: "recommendation_outcome",
        title: `Recommendation completed: ${label}`,
        body: `The ${label} recommendation was completed and verified.`,
        related_twin_id: r.twin_id,
        related_name: empName,
        source_module: "recommendations",
        source_resource_type: "recommendation",
        source_resource_id: r.id,
        source_version: String(r.version),
        source_ref_id: r.id,
        deep_link: `/hub?rec=${encodeURIComponent(r.id)}`,
        action_required: false,
        event_id: `ev:rec:${r.id}`,
      });
    }
  }

  for (const a of inputs.actionTasks) {
    const ownerName = nameOf(a.owner_twin_id) ?? "You";
    if (a.status === "blocked" || a.status === "failed") {
      push(a.owner_twin_id, {
        category: "blocker",
        severity: "high",
        type: "action_task_blocked",
        title: `Action task ${a.status}: ${a.title}`,
        body: a.status === "blocked" ? "This action task is blocked — it needs attention." : "This action task failed and needs a decision.",
        related_twin_id: a.owner_twin_id,
        related_name: ownerName,
        source_module: "recommendations",
        source_resource_type: "action_task",
        source_resource_id: a.id,
        source_version: a.status,
        source_ref_id: a.recommendation_id ?? null,
        deep_link: "/app#action-tasks",
        action_required: true,
        action_label: a.status === "blocked" ? "Resolve" : "Retry or cancel",
        deadline: a.due_at,
        work_item_id: `task:${a.id}`,
        event_id: `ev:at:${a.id}`,
      });
    }
    if (a.status === "completed") {
      push(a.owner_twin_id, {
        category: "status_update",
        severity: "informational",
        type: "action_task_completed",
        title: `Task completed: ${a.title}`,
        body: "Your action task was completed.",
        related_twin_id: a.owner_twin_id,
        related_name: ownerName,
        source_module: "recommendations",
        source_resource_type: "action_task",
        source_resource_id: a.id,
        source_version: a.status,
        source_ref_id: a.recommendation_id ?? null,
        deep_link: "/app#action-tasks",
        action_required: false,
        event_id: `ev:at:${a.id}`,
      });
    }
  }

  // ---- Skills & development --------------------------------------------------
  const claims = inputs.assertions.filter((x) => x.review_state === "claimed" || x.review_state === "extracted");
  if (claims.length > 0) {
    for (const hrId of hrIds) {
      push(hrId, {
        category: "action_required",
        severity: "normal",
        type: "skill_claims_awaiting_review",
        title: `${claims.length} skill claim${claims.length > 1 ? "s" : ""} awaiting verification`,
        body: "Claimed skills must not read as verified evidence until reviewed.",
        related_twin_id: null,
        related_name: null,
        source_module: "skill_data",
        source_resource_type: "skill_assertions",
        source_resource_id: inputs.org_id,
        source_version: String(claims.length),
        source_ref_id: inputs.org_id,
        deep_link: "/workforce/data-quality",
        action_required: true,
        action_label: "Review claims",
        work_item_id: "quality:unverified-claims",
        event_id: "ev:claims",
      });
    }
  }

  // ---- Workforce review -----------------------------------------------------
  for (const c of inputs.reviewCases) {
    const emp = twins.find((t) => t.id === c.twin_id);
    const managerId = emp?.manager_id ?? null;
    const isHigh = c.priority === "review" || c.priority === "high" || c.index >= 60;
    if (!isHigh) continue;
    const deferred = inputs.reviewActions.some(
      (a) => a.twin_id === c.twin_id && a.action === "deferred" && Date.parse(a.acted_at) > Date.parse(now) - 30 * 86400000
    );
    if (deferred) continue;
    const caseName = emp?.name ?? "A team member";
    for (const rec of new Set([managerId, ...hrIds].filter(Boolean) as string[])) {
      push(rec, {
        category: "action_required",
        severity: c.priority === "review" ? "high" : "normal",
        type: "review_case_assigned",
        title: `Workforce review: ${caseName} (${c.index}/100)`,
        body: "An evidence-supported review case is assigned and needs your attention.",
        related_twin_id: c.twin_id,
        related_name: caseName,
        source_module: "workforce_review",
        source_resource_type: "workforce_review_case",
        source_resource_id: c.twin_id,
        source_version: String(c.index),
        source_ref_id: c.twin_id,
        deep_link: `/workforce?twin=${encodeURIComponent(c.twin_id)}`,
        action_required: true,
        action_label: "Review case",
        work_item_id: `review:${c.twin_id}`,
        event_id: `ev:review:${c.twin_id}`,
      });
    }
  }

  // ---- Staffing --------------------------------------------------------------
  for (const sp of inputs.staffingProposals) {
    if (sp.status === "pending_review") {
      for (const hrId of hrIds) {
        push(hrId, {
          category: "action_required",
          severity: "normal",
          type: "staffing_proposal_review",
          title: "Staffing proposal awaits review",
          body: sp.title ?? "A staffing proposal is ready for review.",
          source_module: "staffing",
          source_resource_type: "staffing_proposal",
          source_resource_id: sp.id,
          source_version: sp.status,
          source_ref_id: sp.id,
          deep_link: "/staffing",
          action_required: true,
          action_label: "Review proposal",
          event_id: `ev:staffing:${sp.id}`,
        });
      }
    }
  }

  // ---- Policy -----------------------------------------------------------------
  for (const esc of inputs.escalations) {
    if (esc.status === "open") {
      for (const hrId of hrIds) {
        push(hrId, {
          category: "security",
          severity: "high",
          type: "policy_escalation",
          title: "Policy query escalated",
          body: "A policy query could not be answered safely and needs review.",
          source_module: "policies",
          source_resource_type: "policy_escalation",
          source_resource_id: esc.id,
          source_version: esc.status,
          source_ref_id: esc.id,
          deep_link: "/policy",
          action_required: true,
          action_label: "Review escalation",
          event_id: `ev:esc:${esc.id}`,
        });
      }
    }
  }

  for (const pd of inputs.policyDocs) {
    if (pd.version > 1 && Date.parse(pd.effective_from) > Date.parse(now) - 30 * 86400000) {
      for (const rec of new Set([...hrIds, ...twins.filter((t) => t.role === "manager").map((t) => t.id)])) {
        push(rec, {
          category: "status_update",
          severity: "informational",
          type: "policy_updated",
          title: `Policy updated: ${pd.title}`,
          body: `Version ${pd.version} was published.`,
          source_module: "policies",
          source_resource_type: "policy_document",
          source_resource_id: pd.doc_code,
          source_version: String(pd.version),
          source_ref_id: pd.doc_code,
          deep_link: "/policy",
          action_required: false,
          event_id: `ev:policy:${pd.doc_code}`,
        });
      }
    }
  }

  // ---- Security / administration ----------------------------------------------
  for (const ad of inputs.adminActions) {
    const isAccess = /access|provision|suspend|grant|revoke/i.test(ad.action);
    if (!isAccess) continue;
    const target = ad.target_twin_id ? nameOf(ad.target_twin_id) : null;
    const targets = itTwin ? [itTwin.id, ...hrIds] : hrIds;
    for (const rec of new Set(targets)) {
      push(rec, {
        category: "security",
        severity: "normal",
        type: "access_action",
        title: `Access change: ${ad.action.replace(/_/g, " ")}`,
        body: `${target ?? "A user"} was affected by an access ${ad.action.replace(/_/g, " ")}.`,
        related_twin_id: ad.target_twin_id,
        related_name: target,
        source_module: "access",
        source_resource_type: "admin_action",
        source_resource_id: ad.id,
        source_version: ad.action,
        source_ref_id: ad.id,
        deep_link: "/admin/access",
        action_required: false,
        event_id: `ev:admin:${ad.id}`,
      });
    }
  }

  // ---- Personal reminders (owner-scoped rows) --------------------------------
  for (const p of inputs.personalTasks) {
    if (p.recurrence) continue; // recurring routines materialize as instances
    if (p.status === "done" || p.status === "dismissed") continue;
    const dueKey = p.due_at ? notifDateKey(p.due_at, 0) : null;
    const dueLabel = dueKey === todayKey ? "due today" : dueKey !== null && dueKey < todayKey ? "overdue" : null;
    if (dueLabel === "due today") {
      push(p.owner_twin_id, {
        category: "personal_reminder",
        severity: "normal",
        type: "personal_task_due",
        title: `Reminder: ${p.title}`,
        body: "A personal task is due today.",
        source_module: "personal",
        source_resource_type: "myday_personal_task",
        source_resource_id: p.id,
        source_version: "due_today",
        source_ref_id: p.id,
        deep_link: "/my-day",
        action_required: false,
        deadline: p.due_at,
        work_item_id: `personal:${p.id}`,
        event_id: `ev:personal:${p.id}`,
      });
    }
    if (dueLabel === "overdue") {
      push(p.owner_twin_id, {
        category: "personal_reminder",
        severity: "high",
        type: "personal_task_overdue",
        title: `Overdue: ${p.title}`,
        body: "This personal task rolled over and still needs doing.",
        source_module: "personal",
        source_resource_type: "myday_personal_task",
        source_resource_id: p.id,
        source_version: "overdue",
        source_ref_id: p.id,
        deep_link: "/my-day",
        action_required: false,
        deadline: p.due_at,
        work_item_id: `personal:${p.id}`,
        event_id: `ev:personal:${p.id}`,
      });
    }
  }
  for (const inst of inputs.instances) {
    if (inst.status !== "todo" && inst.status !== "in_progress") continue;
    if (inst.occurrence_date !== todayKey) continue;
    push(inst.owner_twin_id, {
      category: "personal_reminder",
      severity: "normal",
      type: "routine_due",
      title: `Routine: ${inst.title}`,
      body: "Your routine for today is due.",
      source_module: "routine",
      source_resource_type: "myday_recurrence_instance",
      source_resource_id: inst.id,
      source_version: inst.occurrence_date,
      source_ref_id: inst.id,
      deep_link: "/my-day",
      action_required: false,
      work_item_id: `routine:${inst.id}`,
      event_id: `ev:routine:${inst.id}`,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Preference filtering + quiet hours. Critical incidents may bypass quiet
// hours only when the rule explicitly sets quiet_hours_exempt (recorded).
// ---------------------------------------------------------------------------

export function notifFilterByPrefs(drafts: NotifDraft[], prefs: NotifPrefsRow[], now: string, tzOffsetMinutes: number): NotifDraft[] {
  const prefsByTwin = new Map(prefs.map((p) => [p.twin_id, p]));
  const defaultPrefs: NotifPrefsRow = {
    twin_id: "",
    in_app: true,
    assignments: true,
    due_soon: true,
    overdue: true,
    status_updates: true,
    personal_reminders: true,
    daily_digest: true,
    weekly_digest: true,
    quiet_hours_enabled: false,
    quiet_hours_start: "22:00",
    quiet_hours_end: "08:00",
    timezone: "UTC",
    working_days: [1, 2, 3, 4, 5],
  };

  const inQuietHours = (p: NotifPrefsRow): boolean => {
    if (!p.quiet_hours_enabled) return false;
    const m = notifMinuteOf(now, tzOffsetMinutes);
    const start = parseInt(p.quiet_hours_start.slice(0, 2), 10) * 60 + parseInt(p.quiet_hours_start.slice(3, 5) || "0", 10);
    const end = parseInt(p.quiet_hours_end.slice(0, 2), 10) * 60 + parseInt(p.quiet_hours_end.slice(3, 5) || "0", 10);
    if (start <= end) return m >= start && m < end;
    return m >= start || m < end; // crosses midnight
  };

  return drafts.filter((d) => {
    const p = prefsByTwin.get(d.recipient_twin_id) ?? defaultPrefs;
    if (!p.in_app) return false;
    switch (d.category) {
      case "action_required":
        if (d.severity === "critical" || d.severity === "high") {
          // Mandatory operational/security actions are never disabled.
          break;
        }
        return p.assignments;
      case "deadline":
        return d.type.includes("overdue") || d.type.includes("stalled") || d.type.includes("due_today")
          ? p.overdue || p.due_soon
          : p.due_soon;
      case "blocker":
        return true; // blockers always surface
      case "assignment":
        return p.assignments;
      case "decision":
      case "status_update":
        return p.status_updates;
      case "security":
        return true; // security events always surface
      case "personal_reminder":
        return p.personal_reminders;
      default:
        return true;
    }
  }).filter((d) => {
    const p = prefsByTwin.get(d.recipient_twin_id) ?? defaultPrefs;
    if (!d.quiet_hours_exempt && inQuietHours(p) && (d.severity === "normal" || d.severity === "informational")) {
      // Suppress non-urgent deliveries during quiet hours (still persisted,
      // visible when the user opens the center). Critical/high are exempt.
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Resolution: notifications whose source condition no longer applies resolve.
// The scan computes "active conditions" and resolves the matching records.
// ---------------------------------------------------------------------------

export interface NotifActiveCondition {
  type: string;
  source_resource_type: string;
  source_resource_id: string;
  source_version: string;
}

export function notifActiveConditions(inputs: NotifInputs, todayKey: string): NotifActiveCondition[] {
  const out: NotifActiveCondition[] = [];
  for (const t of inputs.tasks) {
    const itemKey = `${t.owner_role === "it_security" ? "provisioning" : "onboarding"}:${t.plan_id}:${t.task_code}`;
    const openBlockers = (t.blockers ?? []).filter((b) => b.status === "open").length;
    if (openBlockers > 0 || t.state === "blocked") {
      out.push({ type: "onboarding_blocked", source_resource_type: "onboarding_task", source_resource_id: `${t.plan_id}:${t.task_code}`, source_version: t.state });
      out.push({ type: "onboarding_blocker_watch", source_resource_type: "onboarding_task", source_resource_id: `${t.plan_id}:${t.task_code}`, source_version: t.state });
    }
    if (t.owner_role === "employee" && (t.state === "ready" || t.state === "in_progress")) {
      out.push({ type: "task_actionable", source_resource_type: "onboarding_task", source_resource_id: `${t.plan_id}:${t.task_code}`, source_version: t.state });
    }
    if (t.owner_role === "it_security" && (t.state === "ready" || t.state === "in_progress")) {
      out.push({ type: "provisioning_required", source_resource_type: "onboarding_task", source_resource_id: `${t.plan_id}:${t.task_code}`, source_version: t.state });
    }
    if (t.owner_role === "employee" && t.due_date && t.state !== "done") {
      const dueKey = notifDateKey(t.due_date, 0);
      if (dueKey === todayKey) out.push({ type: "task_due_today", source_resource_type: "onboarding_task", source_resource_id: `${t.plan_id}:${t.task_code}`, source_version: t.state });
      if (dueKey < todayKey) out.push({ type: "task_overdue", source_resource_type: "onboarding_task", source_resource_id: `${t.plan_id}:${t.task_code}`, source_version: t.state });
    }
    void itemKey;
  }
  for (const p of inputs.plans) {
    if (p.status === "pending_approval") out.push({ type: "plan_awaiting_approval", source_resource_type: "onboarding_plan", source_resource_id: p.id, source_version: String(p.version) });
  }
  for (const r of inputs.recommendations) {
    if (r.status === "needs_review") out.push({ type: "recommendation_review", source_resource_type: "recommendation", source_resource_id: r.id, source_version: String(r.version) });
    if (r.status === "execution_pending") {
      out.push({ type: "recommendation_review", source_resource_type: "recommendation", source_resource_id: r.id, source_version: String(r.version) });
    }
  }
  for (const a of inputs.actionTasks) {
    if (a.status === "blocked" || a.status === "failed") {
      out.push({ type: "action_task_blocked", source_resource_type: "action_task", source_resource_id: a.id, source_version: a.status });
    }
  }
  for (const s of inputs.sessions) {
    if (s.status === "invited" || s.status === "submitted") {
      out.push({ type: s.status === "submitted" ? "assessment_awaiting_review" : "assessment_invitation_pending", source_resource_type: "candidate_session", source_resource_id: s.id, source_version: s.status });
    }
  }
  for (const a of inputs.applications) {
    const ageDays = Math.floor((Date.now() - Date.parse(a.applied_at)) / 86400000);
    if ((a.stage === "screening" || a.stage === "technical_interview") && ageDays >= 14) {
      out.push({ type: "application_stalled", source_resource_type: "application", source_resource_id: a.candidate_twin_id, source_version: String(a.version) });
    }
  }
  for (const as of inputs.assessments) {
    if (!as.reviewed_at && as.result?.review_required === true) {
      out.push({ type: "assessment_review_required", source_resource_type: "assessment", source_resource_id: as.id, source_version: "unreviewed" });
    }
  }
  for (const esc of inputs.escalations) {
    if (esc.status === "open") out.push({ type: "policy_escalation", source_resource_type: "policy_escalation", source_resource_id: esc.id, source_version: esc.status });
  }
  for (const sp of inputs.staffingProposals) {
    if (sp.status === "pending_review") out.push({ type: "staffing_proposal_review", source_resource_type: "staffing_proposal", source_resource_id: sp.id, source_version: sp.status });
  }
  for (const c of inputs.reviewCases) {
    if (c.priority === "review" || c.priority === "high" || c.index >= 60) {
      out.push({ type: "review_case_assigned", source_resource_type: "workforce_review_case", source_resource_id: c.twin_id, source_version: String(c.index) });
    }
  }
  const claims = inputs.assertions.filter((x) => x.review_state === "claimed" || x.review_state === "extracted").length;
  if (claims > 0) out.push({ type: "skill_claims_awaiting_review", source_resource_type: "skill_assertions", source_resource_id: inputs.org_id, source_version: String(claims) });
  for (const p of inputs.personalTasks) {
    if (p.recurrence) continue;
    if (p.status === "done" || p.status === "dismissed") continue;
    const dueKey = p.due_at ? notifDateKey(p.due_at, 0) : null;
    if (dueKey === todayKey) out.push({ type: "personal_task_due", source_resource_type: "myday_personal_task", source_resource_id: p.id, source_version: "due_today" });
    if (dueKey !== null && dueKey < todayKey) out.push({ type: "personal_task_overdue", source_resource_type: "myday_personal_task", source_resource_id: p.id, source_version: "overdue" });
  }
  for (const inst of inputs.instances) {
    if (inst.status === "todo" || inst.status === "in_progress") {
      out.push({ type: "routine_due", source_resource_type: "myday_recurrence_instance", source_resource_id: inst.id, source_version: inst.occurrence_date });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Digest — deterministic facts from canonical data. Never Qwen-driven for
// priorities/recipients; a prose model may only rephrase these facts later.
// ---------------------------------------------------------------------------

export interface NotifDigestItem {
  title: string;
  deep_link: string | null;
  group: string;
  origin: string;
  status: string;
  due_key: string | null;
  priority_band: string;
}

export interface NotifDigest {
  period: "daily" | "weekly";
  period_key: string;
  generated_at: string;
  facts: string[];
  priorities: { title: string; link: string | null; label: string }[];
  summary: { attention: number; due_today: number; blocked: number; waiting: number; completed_today: number };
}

export function notifBuildDigest(
  inputs: NotifInputs,
  items: NotifDigestItem[],
  role: string,
  period: "daily" | "weekly",
  now: string,
  todayKey: string,
  tzOffsetMinutes: number
): NotifDigest {
  const weekStart = notifAddDays(todayKey, -6);
  const facts: string[] = [];

  const attention = items.filter((i) => i.group === "attention" && i.status !== "done").length;
  const dueToday = items.filter((i) => i.due_key === todayKey && i.status !== "done").length;
  const blocked = items.filter((i) => i.status === "blocked").length;
  const waiting = items.filter((i) => i.status === "waiting").length;
  const completedToday = items.filter((i) => i.status === "done").length;

  const plansPending = inputs.plans.filter((p) => p.status === "pending_approval").length;
  const recsPending = inputs.recommendations.filter((r) => r.status === "needs_review").length;
  const sessionsAwaiting = inputs.sessions.filter((s) => s.status === "submitted").length;
  const provisioningDue = inputs.tasks.filter((t) => t.owner_role === "it_security" && (t.state === "ready" || t.state === "in_progress")).length;
  const routinesToday = inputs.instances.filter((i) => i.occurrence_date === todayKey && (i.status === "todo" || i.status === "in_progress")).length;
  const actionTasksDueSoon = inputs.actionTasks.filter((a) => a.status !== "completed" && a.due_at != null && notifDateKey(a.due_at, 0) <= todayKey).length;
  const carryOver = inputs.personalTasks.reduce((n, p) => n + (p.rollover_count > 0 ? 1 : 0), 0);

  if (period === "daily") {
    if (attention > 0) facts.push(`${attention} item${attention > 1 ? "s" : ""} need${attention === 1 ? "s" : ""} your attention.`);
    if (dueToday > 0) facts.push(`${dueToday} item${dueToday > 1 ? "s are" : " is"} due today.`);
    if (blocked > 0) facts.push(`${blocked} item${blocked > 1 ? "s are" : " is"} blocked — resolve or reassign to keep flows moving.`);
    if (waiting > 0) facts.push(`${waiting} item${waiting > 1 ? "s are" : " is"} waiting on others (not counted against you).`);
    if (plansPending > 0) facts.push(`${plansPending} onboarding plan${plansPending > 1 ? "s" : ""} await${plansPending === 1 ? "s" : ""} approval.`);
    if (recsPending > 0) facts.push(`${recsPending} recommendation${recsPending > 1 ? "s" : ""} await${recsPending === 1 ? "s" : ""} sign-off.`);
    if (sessionsAwaiting > 0) facts.push(`${sessionsAwaiting} assessment${sessionsAwaiting > 1 ? "s" : ""} await${sessionsAwaiting === 1 ? "s" : ""} review.`);
    if (provisioningDue > 0) facts.push(`${provisioningDue} provisioning handoff${provisioningDue > 1 ? "s are" : " is"} due.`);
    if (routinesToday > 0) facts.push(`${routinesToday} personal routine${routinesToday > 1 ? "s" : ""} due today.`);
    if (completedToday > 0) facts.push(`${completedToday} personal & routine completion${completedToday > 1 ? "s" : ""} today.`);
  } else {
    const completedWorkflow = inputs.tasks.filter((t) => t.completion_at != null && notifDateKey(t.completion_at, tzOffsetMinutes) >= weekStart).length +
      inputs.actionTasks.filter((a) => a.completed_at != null && notifDateKey(a.completed_at, tzOffsetMinutes) >= weekStart).length;
    if (completedWorkflow > 0) facts.push(`${completedWorkflow} workflow action${completedWorkflow > 1 ? "s" : ""} completed this week.`);
    if (carryOver > 0) facts.push(`${carryOver} personal task${carryOver > 1 ? "s" : ""} rolled over from an earlier day.`);
    const becomingOverdue = inputs.tasks.filter((t) => t.state !== "done" && t.due_date != null && {}) .length;
    void becomingOverdue;
    if (actionTasksDueSoon > 0) facts.push(`${actionTasksDueSoon} action task${actionTasksDueSoon > 1 ? "s" : ""} due or overdue.`);
    if (plansPending > 0) facts.push(`${plansPending} onboarding plan${plansPending > 1 ? "s" : ""} need${plansPending === 1 ? "s" : ""} approval.`);
    if (recsPending > 0) facts.push(`${recsPending} recommendation${recsPending > 1 ? "s" : ""} review${recsPending === 1 ? "" : "s"} pending.`);
    const upcomingSessions = inputs.sessions.filter((s) => s.expires_at != null && notifDateKey(s.expires_at, 0) >= todayKey && notifDateKey(s.expires_at, 0) <= notifAddDays(todayKey, 7)).length;
    if (upcomingSessions > 0) facts.push(`${upcomingSessions} candidate assessment${upcomingSessions > 1 ? "s" : ""} expiring within a week.`);
    if (provisioningDue > 0) facts.push(`${provisioningDue} provisioning handoff${provisioningDue > 1 ? "s are" : " is"} outstanding.`);
    const routinesWeek = inputs.instances.filter((i) => i.occurrence_date >= weekStart && i.occurrence_date <= todayKey).length;
    facts.push(`${routinesWeek} personal routine occurrence${routinesWeek > 1 ? "s" : ""} this week.`);
  }
  if (facts.length === 0) facts.push(period === "daily" ? "Nothing urgent today." : "A steady week — no open attention items.");

  const priorities = items
    .filter((i) => i.status !== "done" && (i.group === "attention" || i.group === "today"))
    .sort((a, b) => (a.priority_band === "Critical" ? -1 : 1) - (b.priority_band === "Critical" ? -1 : 1))
    .slice(0, 5)
    .map((i) => ({ title: i.title, link: i.deep_link, label: i.group === "attention" ? "Needs attention" : "Due today" }));

  return {
    period,
    period_key: period === "daily" ? todayKey : `${weekStart}:${todayKey}`,
    generated_at: now,
    facts,
    priorities,
    summary: { attention, due_today: dueToday, blocked, waiting, completed_today: completedToday },
  };
}

// ---------------------------------------------------------------------------
// Workflow analytics — honest workflow-health metrics. Never efficiency
// scores. Blocked/waiting time is reported separately; on-time denominators
// exclude waiting/blocked/informational items. Medians are used for skew.
// ---------------------------------------------------------------------------

export interface NotifAnalytics {
  as_of: string;
  scope: string;
  role: string;
  notes: string[];
  period_days: number;
  completed_count: number;
  eligible_completed: number;
  on_time: number;
  on_time_rate: number | null;
  overdue_backlog: number;
  blocked_now: number;
  waiting_now: number;
  reopened_failed: number;
  median_cycle_hours: number | null;
  mean_cycle_hours: number | null;
  completed_last7: number;
  completed_prior7: number;
  week_over_week_pct: number | null;
  by_module: { module: string; count: number }[];
  rolled_over: number;
  completed_after_rollover: number;
}

function notifMedian(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function notifWorkflowAnalytics(
  inputs: NotifInputs,
  scopeTwinIds: Set<string>,
  role: string,
  now: string,
  todayKey: string,
  tzOffsetMinutes: number
): NotifAnalytics {
  const nowMs = Date.parse(now);
  const weekStart = notifAddDays(todayKey, -6);
  const priorStart = notifAddDays(todayKey, -13);
  const notes: string[] = [];

  // Onboarding tasks + action tasks within scope.
  const inScope = (twinId: string | null) => twinId != null && scopeTwinIds.has(twinId);
  const obTasks = inputs.tasks.filter((t) => inScope(t.twin_id));
  const atTasks = inputs.actionTasks.filter((t) => inScope(t.owner_twin_id));

  const completed: { at: string; due: string | null; module: string }[] = [];
  for (const t of obTasks) {
    if (t.state === "done" && t.completion_at) completed.push({ at: t.completion_at, due: t.due_date, module: t.task_type });
  }
  for (const a of atTasks) {
    if (a.status === "completed" && a.completed_at) completed.push({ at: a.completed_at, due: a.due_at, module: "recommendation" });
  }

  const cycleHours: number[] = [];
  for (const t of obTasks) {
    if (t.state === "done" && t.completion_at) {
      const start = new Date(nowMs - 30 * 86400000); // fallback proxy
      const plan = inputs.plans.find((p) => p.id === t.plan_id);
      const firstActionable = plan?.start_date ? Date.parse(plan.start_date) : start.getTime();
      cycleHours.push((Date.parse(t.completion_at) - firstActionable) / 3600000);
    }
  }
  for (const a of atTasks) {
    if (a.status === "completed" && a.completed_at && a.started_at) {
      cycleHours.push((Date.parse(a.completed_at) - Date.parse(a.started_at)) / 3600000);
    }
  }

  const eligibleCompleted = completed.filter((c) => c.due != null && notifDateKey(c.due, 0) <= todayKey).length;
  const onTime = completed.filter((c) => c.due != null && Date.parse(c.at) <= Date.parse(c.due)).length;

  const overdueBacklog = obTasks.filter((t) => t.state !== "done" && t.due_date != null && notifDateKey(t.due_date, 0) < todayKey).length +
    atTasks.filter((a) => a.status !== "completed" && a.status !== "cancelled" && a.due_at != null && notifDateKey(a.due_at, 0) < todayKey).length;

  const completedLast7 = completed.filter((c) => notifDateKey(c.at, tzOffsetMinutes) >= weekStart).length;
  const completedPrior7 = completed.filter((c) => notifDateKey(c.at, tzOffsetMinutes) >= priorStart && notifDateKey(c.at, tzOffsetMinutes) < weekStart).length;

  const moduleCounts = new Map<string, number>();
  for (const c of completed) {
    moduleCounts.set(c.module, (moduleCounts.get(c.module) ?? 0) + 1);
  }
  for (const a of atTasks) {
    if (a.status === "completed") moduleCounts.set("recommendation", (moduleCounts.get("recommendation") ?? 0) + 1);
  }
  const byModule = [...moduleCounts.entries()].map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count);

  const rolledOver = inputs.personalTasks.filter((p) => p.rollover_count > 0).length;
  const completedAfterRollover = inputs.personalTasks.filter((p) => p.rollover_count > 0 && p.status === "done").length;

  if (obTasks.length + atTasks.length === 0) notes.push("No scoped workflow tasks in the period — metrics are empty, not zero-rated.");
  notes.push("Cycle time uses the plan start date as the first-actionable proxy where per-task timestamps are not recorded.");
  notes.push("Blocked/waiting items are excluded from on-time denominators and reported separately.");
  notes.push("These metrics describe workflow movement and task state. They do not measure employee value, effort or performance and are not used for automated employment decisions.");

  const completedCount = completed.length;
  return {
    as_of: now,
    scope: "scope",
    role,
    notes,
    period_days: 7,
    completed_count: completedCount,
    eligible_completed: eligibleCompleted,
    on_time: onTime,
    on_time_rate: eligibleCompleted > 0 ? Math.round((onTime / eligibleCompleted) * 100) : null,
    overdue_backlog: overdueBacklog,
    blocked_now: obTasks.filter((t) => t.state === "blocked" || (t.blockers ?? []).some((b) => b.status === "open")).length,
    waiting_now: 0,
    reopened_failed: atTasks.filter((a) => a.status === "failed").length,
    median_cycle_hours: notifMedian(cycleHours),
    mean_cycle_hours: cycleHours.length > 0 ? Math.round((cycleHours.reduce((s, x) => s + x, 0) / cycleHours.length) * 10) / 10 : null,
    completed_last7: completedLast7,
    completed_prior7: completedPrior7,
    week_over_week_pct: completedPrior7 > 0 ? Math.round(((completedLast7 - completedPrior7) / completedPrior7) * 100) : completedLast7 > 0 ? 100 : null,
    by_module: byModule,
    rolled_over: rolledOver,
    completed_after_rollover: completedAfterRollover,
  };
}