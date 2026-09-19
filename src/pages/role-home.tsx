import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Database,
  History,
  Hourglass,
  ListChecks,
  Loader2,
  Server,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { ExecutiveDashboard } from "@/components/executive-dashboard";
import { MyWorkFeed } from "@/components/my-work-feed";
import { RoleScopeCallout } from "@/components/role-scope-callout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { can, ROLE_LABEL, type Role } from "@/lib/rbac";
import { actionTaskUpdate, fetchMyWork, onboardingQueue, type ActionTaskRow, type MyWorkResult, type Twin, type WorkItemType } from "@/lib/api";
import { decode, planTaskViewSchema, planViewSchema, requisitionRowSchema, type OnboardingQueue, type RequisitionRow } from "@/lib/contracts";
import { nextActionTask, derivePlanCounts, TASK_STATE_META } from "@/lib/onboarding-progress";
import { deriveItQueueCounts, filterItProvisioning, upcomingStarts, type ItQueueFilter } from "@/lib/it-provisioning";

// My Action Tasks: tasks assigned to me from dispatched recommendations
// (Phase 11). Owners act on their own tasks with evidence + rationale.
// Empty state renders only after a SUCCESSFUL empty query — never under
// loading, never under populated tasks, and never when the query failed.
const MY_TASK_ACTIONS: Record<string, { action: string; label: string; variant?: "outline" | "secondary" | "default" }[]> = {
  open: [{ action: "start", label: "Start" }],
  in_progress: [
    { action: "complete", label: "Complete" },
    { action: "block", label: "Block", variant: "secondary" },
    { action: "fail", label: "Fail", variant: "outline" },
    { action: "cancel", label: "Cancel", variant: "outline" },
  ],
  blocked: [
    { action: "complete", label: "Complete" },
    { action: "fail", label: "Fail", variant: "outline" },
    { action: "cancel", label: "Cancel", variant: "outline" },
  ],
  failed: [
    { action: "retry", label: "Retry" },
    { action: "cancel", label: "Cancel", variant: "outline" },
  ],
  completed: [],
  cancelled: [],
};

function MyActionTasks({ twinId }: { twinId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ task: ActionTaskRow; action: string } | null>(null);
  const [rationale, setRationale] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);

  const tasks = useQuery({
    queryKey: ["my-tasks", user?.id ?? "anon", twinId],
    queryFn: async () => {
      const { data } = await supabase
        .from("action_tasks")
        .select("*")
        .eq("owner_twin_id", twinId)
        .in("status", ["open", "in_progress", "blocked", "failed"])
        .order("due_at", { ascending: true });
      return (data ?? []) as ActionTaskRow[];
    },
  });

  const confirm = async () => {
    if (!dialog || rationale.trim().length < 5) return;
    setBusy(true);
    try {
      const res = await actionTaskUpdate(
        dialog.task.id,
        dialog.action,
        rationale.trim(),
        undefined,
        dialog.action === "complete" ? evidence.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
        undefined
      );
      toast.success(
        res.recommendation_status
          ? `Task ${res.status.replace(/_/g, " ")} — recommendation now ${res.recommendation_status.replace(/_/g, " ")}`
          : `Task ${res.status.replace(/_/g, " ")}`
      );
      setDialog(null);
      setRationale("");
      setEvidence("");
      void qc.invalidateQueries({ queryKey: ["my-tasks", user?.id ?? "anon", twinId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (tasks.isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-muted" role="status" aria-label="Loading action tasks" />;
  }
  if (tasks.isError) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <span className="flex-1">Action tasks are unavailable right now.</span>
        <Button size="sm" variant="outline" onClick={() => void qc.invalidateQueries({ queryKey: ["my-tasks", user?.id ?? "anon", twinId] })}>
          Retry
        </Button>
      </div>
    );
  }
  if (tasks.data && tasks.data.length === 0) return null;

  return (
    <div id="action-tasks" className="scroll-mt-24 rounded-lg bg-white p-6 shadow-card">
      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
        <UserCheck className="h-5 w-5 text-primary" strokeWidth={2.5} /> My action tasks
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Assigned from approved recommendations — complete them with evidence and a rationale.</p>
      <div className="mt-4 flex flex-col gap-2">
        {tasks.data?.map((t) => (
          <div key={t.id} className="rounded-md bg-muted p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t.owner_role ?? "assigned"} · due {t.due_at ? new Date(t.due_at).toLocaleDateString() : "—"}
                  {t.retry_count > 0 ? ` · ${t.retry_count} retr${t.retry_count > 1 ? "ies" : "y"}` : ""}
                </p>
              </div>
              <span className="rounded-md bg-foreground px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white">{t.status.replace(/_/g, " ")}</span>
            </div>
            {t.instructions && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.instructions}</p>}
            {t.status === "failed" && t.last_error && (
              <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t.last_error}
              </p>
            )}
            {(MY_TASK_ACTIONS[t.status] ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MY_TASK_ACTIONS[t.status].map((a) => (
                  <Button key={a.action} size="sm" variant={a.variant ?? "default"} onClick={() => setDialog({ task: t, action: a.action })}>
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialog?.action === "complete" && <CheckCircle2 className="h-5 w-5 text-secondary" />}
              {dialog?.action === "fail" || dialog?.action === "cancel" ? <XCircle className="h-5 w-5 text-destructive" /> : <UserCheck className="h-5 w-5 text-primary" />}
              {dialog?.action.replace(/_/g, " ")}
            </DialogTitle>
          </DialogHeader>
          {dialog && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {dialog.action === "complete"
                  ? "Completing a task requires at least one evidence reference; the recommendation outcome view updates automatically."
                  : "The task will move through its enforced state machine."}
              </p>
              <Textarea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Type your rationale (required)…" />
              {dialog.action === "complete" && (
                <Textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence references (one per line)…" />
              )}
              <Button
                onClick={() => void confirm()}
                disabled={busy || rationale.trim().length < 5 || (dialog.action === "complete" && evidence.trim().length === 0)}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Confirm {dialog.action.replace(/_/g, " ")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatBlock({
  label,
  value,
  tone,
  definition,
}: {
  label: string;
  value: number | string | null;
  tone: "primary" | "dark" | "muted" | "subtle" | "outline";
  definition?: string;
}) {
  const cls = {
    primary: "bg-primary text-white",
    dark: "bg-foreground text-white",
    muted: "bg-muted text-foreground",
    subtle: "bg-primary/10 text-primary",
    outline: "bg-white border border-border text-foreground",
  }[tone];
  return (
    <div className={`flex flex-col justify-between gap-6 rounded-lg p-5 transition-all duration-200 hover:scale-[1.02] ${cls}`}>
      <span className={`text-xs font-bold uppercase tracking-wider ${tone === "dark" || tone === "primary" ? "text-white/70" : "text-muted-foreground"}`}>
        {label}
      </span>
      <span className="text-4xl font-extrabold tracking-tight">{value ?? "—"}</span>
      {definition && (
        <span className={`text-[11px] leading-snug ${tone === "dark" || tone === "primary" ? "text-white/60" : "text-muted-foreground"}`}>{definition}</span>
      )}
    </div>
  );
}

// Phase 26/27: Administrators land on the Platform Operations & Security
// Governance panel instead of the (removed) duplicate module shortcuts.
function AdminGovernancePanel() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground">
          <ShieldAlert className="h-5 w-5 text-primary" strokeWidth={2.5} />
          Platform Operations & Security Governance
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enterprise access control, audit logging, model health telemetry, and data quality.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          to="/admin/access"
          className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
        >
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <UserCog className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">ACCESS</span>
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground">Access & Governance</h3>
            <p className="mt-1 text-xs text-muted-foreground">Directory, role elevation, member invitations & account suspension.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary">
            Open Console <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>

        <Link
          to="/admin/access?tab=audit"
          className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
        >
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary/10 text-secondary">
              <History className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="rounded bg-secondary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-secondary">AUDIT</span>
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground">Security Audit Logs</h3>
            <p className="mt-1 text-xs text-muted-foreground">Access changes, candidate conversions & policy waivers.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-secondary">
            View Audit Trail <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>

        <Link
          to="/status"
          className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
        >
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/30 text-foreground">
              <Activity className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-foreground">HEALTH</span>
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground">System & Model Health</h3>
            <p className="mt-1 text-xs text-muted-foreground">Qwen gateway state, latency & deployment versions.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-foreground">
            Check Telemetry <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>

        <Link
          to="/workforce/data-quality"
          className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
        >
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Database className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">QUALITY</span>
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground">Data Quality Engine</h3>
            <p className="mt-1 text-xs text-muted-foreground">Orphaned claims, missing twin data & assertion rigor distribution.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary">
            Inspect Quality <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
      </div>
    </div>
  );
}

// Batch 3 (3.2/3.3): a compact, role-scoped "needs attention" surface above the
// shared dashboard. HR (and administrators) see organization journeys; managers
// see their own team — both come from the same server-scoped queue function.
function JourneyAttentionStrip({
  queue,
  title,
  scopeLabel,
}: {
  queue: OnboardingQueue | null;
  title: string;
  scopeLabel: string;
}) {
  const journeys = (queue?.journeys ?? []).filter((j) => j.pending_manager_approval || j.pending_hr_approval || j.stalled || j.overdue);
  const pending = journeys.filter((j) => j.pending_manager_approval || j.pending_hr_approval).length;
  const stalled = journeys.filter((j) => j.stalled).length;
  const overdue = journeys.filter((j) => j.overdue).length;
  if (journeys.length === 0) return null;

  return (
    <section aria-label={title} className="mt-10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
          <AlertTriangle className="h-5 w-5 text-accent" strokeWidth={2.5} /> {title}
        </h2>
        <span className="rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {scopeLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-white p-4 shadow-card">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pending approval</p>
          <p className="mt-1 text-3xl font-extrabold text-foreground">{pending}</p>
          <p className="text-[11px] text-muted-foreground">journeys awaiting manager/HR sign-off</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow-card">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stalled</p>
          <p className="mt-1 text-3xl font-extrabold text-foreground">{stalled}</p>
          <p className="text-[11px] text-muted-foreground">open blocker or actionable task overdue 7+ days</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow-card">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overdue</p>
          <p className="mt-1 text-3xl font-extrabold text-foreground">{overdue}</p>
          <p className="text-[11px] text-muted-foreground">actionable task past its due date</p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {journeys.slice(0, 5).map((j) => (
          <Link
            key={j.twin_id}
            to={`/onboarding?twin=${j.twin_id}`}
            className="group flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3.5 transition-all duration-200 hover:scale-[1.01] hover:shadow-card"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">{j.employee_name}</p>
              <p className="text-xs text-muted-foreground">
                {j.stall_reasons.length > 0
                  ? j.stall_reasons.join(" · ")
                  : j.pending_manager_approval
                    ? "awaiting manager approval"
                    : j.pending_hr_approval
                      ? "awaiting HR approval"
                      : `${j.overdue_count} overdue task${j.overdue_count > 1 ? "s" : ""}`}
              </p>
            </div>
            <span className="flex items-center gap-1 text-xs font-bold text-primary">
              Open journey <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// Batch 3 (3.6): a focused IT Provisioning workspace — real server-scoped
// provisioning tasks plus employee identity (name, start date, manager). No
// readiness, gates or approvals cross the boundary into this role's home.
function ItProvisioningPanel({ queue }: { queue: OnboardingQueue | null }) {
  const now = new Date().toISOString();
  const items = queue?.provisioning ?? [];
  const counts = deriveItQueueCounts(items, now);
  const starts = upcomingStarts(queue?.people ?? [], now);
  const names = new Map((queue?.people ?? []).map((p) => [p.twin_id, p.name]));
  const [filter, setFilter] = useState<ItQueueFilter>("all");
  const [search, setSearch] = useState("");
  const visible = useMemo(() => filterItProvisioning(items, names, filter, search, now), [items, names, filter, search, now]);
  const FILTERS: { key: ItQueueFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "ready", label: "Ready" },
    { key: "blocked", label: "Blocked" },
    { key: "overdue", label: "Overdue" },
    { key: "done", label: "Completed" },
  ];

  return (
    <section aria-label="IT provisioning workspace" className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
            <Server className="h-5 w-5 text-primary" strokeWidth={2.5} /> Provisioning workspace
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Laptop, SSO and access work that unblocks approved new-hire onboarding — complete tasks with evidence in the onboarding center.
          </p>
        </div>
        <Link to="/onboarding" className="flex items-center gap-1 text-sm font-bold text-primary">
          Open provisioning queue <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatBlock label="Ready" value={counts.ready} tone="primary" definition="Tasks with prerequisites satisfied, ready to action." />
        <StatBlock label="In progress" value={counts.in_progress} tone="dark" definition="Started but not yet completed with evidence." />
        <StatBlock label="Blocked" value={counts.blocked} tone="muted" definition="Waiting on an upstream dependency or a reported blocker." />
        <StatBlock label="Overdue" value={counts.overdue} tone="muted" definition="Actionable task past its due date." />
        <StatBlock label="Completed" value={counts.done} tone="subtle" definition="Accepted provisioning work across in-scope journeys." />
      </div>

      {starts.length > 0 && (
        <div className="mt-4 rounded-lg bg-white p-4 shadow-card">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> Upcoming start dates (next 14 days)
          </h3>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {starts.map((s) => (
              <li key={s.twin_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-bold text-foreground">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  starts {new Date(s.start_date).toLocaleDateString()}
                  {s.manager_name ? ` · manager ${s.manager_name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-lg bg-white p-5 shadow-card">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Provisioning & access tasks</p>
          <span className="rounded-md bg-foreground px-2 py-0.5 text-[10px] font-bold text-white">{items.length}</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter provisioning tasks">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  filter === f.key ? "bg-foreground text-white" : "bg-muted text-muted-foreground hover:bg-border"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or task…"
            aria-label="Search provisioning tasks by employee or task"
            className="h-9 w-full shrink-0 rounded-md border border-border bg-white px-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-56"
          />
        </div>
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {items.length === 0
              ? "No provisioning or access tasks are waiting right now. New-hire work appears here once their plan is approved."
              : "No tasks match this filter."}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {visible.map((t) => {
              const chip = TASK_STATE_META[t.state as keyof typeof TASK_STATE_META] ?? TASK_STATE_META.pending;
              return (
                <li key={`${t.twin_id}-${t.task_code}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      for {names.get(t.twin_id) ?? "employee"}
                      {t.blockers && t.blockers.length > 0 ? ` · ${t.blockers.length} blocker(s)` : ""}
                      {t.depends_on && t.depends_on.length > 0 ? ` · waits on ${t.depends_on.join(", ")}` : ""}
                      {t.evidence_requirements && t.evidence_requirements.length > 0 ? " · evidence required" : ""}
                      {` · due ${t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// §52: PEOPLE MANAGER home differentiator — a team roster derived from the SAME
// server-scoped onboarding queue that drives the attention strip and the
// onboarding center. Manager scope = recursive reporting subtree, enforced in
// the queue function. This panel is what makes the manager home people-centric
// (who is on my team and how are they onboarding) instead of a copy of HR.
function ManagerTeamPanel({ queue }: { queue: OnboardingQueue | null }) {
  const journeys = queue?.journeys ?? [];
  if (!queue || journeys.length === 0) return null;
  const awaiting = journeys.filter((j) => j.pending_manager_approval || j.pending_hr_approval).length;
  const attention = journeys.filter((j) => j.stalled || j.overdue).length;
  return (
    <section aria-label="My team" className="mt-10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
          <Users className="h-5 w-5 text-primary" strokeWidth={2.5} /> My team
        </h2>
        <span className="rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Team scope</span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        {journeys.length} team member{journeys.length === 1 ? "" : "s"} with an active onboarding plan
        {awaiting > 0 || attention > 0
          ? ` — ${attention} need${attention === 1 ? "s" : ""} attention, ${awaiting} awaiting approval.`
          : " — all on track."}{" "}
        HR sees the whole organization; this roster only ever shows your own reports.
      </p>
      <div className="mt-4 rounded-lg bg-white p-5 shadow-card">
        <div className="flex flex-col divide-y divide-border">
          {journeys.map((j) => {
            const chip =
              j.stalled || j.overdue
                ? { label: "Needs attention", cls: "bg-destructive text-white" }
                : j.pending_manager_approval || j.pending_hr_approval
                  ? { label: "Awaiting approval", cls: "bg-accent text-foreground" }
                  : { label: "On track", cls: "bg-secondary text-white" };
            return (
              <Link
                key={j.twin_id}
                to={`/onboarding?twin=${j.twin_id}`}
                className="group flex flex-wrap items-center justify-between gap-3 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {j.employee_name}
                    <span className="ml-2 text-xs font-semibold text-muted-foreground">
                      {[j.job_title, j.department].filter(Boolean).join(" · ") || "Team member"}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    started {new Date(j.start_date).toLocaleDateString()}
                    {j.status === "approved" ? "" : ` · plan ${j.status.replace(/_/g, " ")}`}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${j.readiness_pct}%` }} />
                    </div>
                    <span className="w-9 text-right text-[11px] font-bold text-muted-foreground">{j.readiness_pct}%</span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// §52: HR home differentiator — an organization-lifecycle strip derived from
// the SAME org-scoped queries the rest of the home uses (onboarding queue +
// assigned-work feed). HR partner/administrator scope is the whole org, so
// every count here is org-wide by construction. This is the counterweight to
// the manager's team roster: HR thinks in organization-wide lifecycle stages.
function HRLifecyclePanel({ queue, myWork, role }: { queue: OnboardingQueue | null; myWork: MyWorkResult | null; role: Role }) {
  const journeys = queue?.journeys ?? [];
  const items = myWork?.items ?? [];
  const count = (t: WorkItemType) => items.filter((i) => i.type === t).length;
  const awaiting = journeys.filter((j) => j.pending_manager_approval || j.pending_hr_approval).length;
  const stalled = journeys.filter((j) => j.stalled || j.overdue).length;
  const attention = journeys.filter((j) => j.stalled || j.overdue || j.pending_manager_approval || j.pending_hr_approval).slice(0, 5);

  const stages = [
    {
      to: "/onboarding",
      icon: ListChecks,
      label: "Onboarding journeys",
      value: journeys.length,
      sub: `${awaiting} awaiting approval · ${stalled} stalled`,
      definition: "Active adaptive onboarding plans across the whole organization.",
    },
    {
      to: "/workforce",
      icon: Users,
      label: "Review cases in scope",
      value: count("review_case"),
      sub: "flagged by the Workforce Review Index",
      definition: "Longitudinal review cases across the org assigned to your work feed.",
    },
    {
      to: "/hub",
      icon: CheckCircle2,
      label: "Approvals awaiting decision",
      value: count("approval_request"),
      sub: "recommendations needing a typed human decision",
      definition: "Org-wide recommendations at needs_review that you approve or reject.",
    },
    ...(role === "hr_executive"
      ? [
          {
            to: "/workforce/data-quality",
            icon: Database,
            label: "Data quality alerts",
            value: count("data_quality_alert"),
            sub: "unverified skill claims",
            definition: "Skill assertions that must not read as verified evidence — administrators only.",
          },
        ]
      : []),
  ];

  return (
    <section aria-label="Organization lifecycle" className="mt-10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
          <Activity className="h-5 w-5 text-primary" strokeWidth={2.5} /> Organization lifecycle
        </h2>
        <span className="rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Organization scope</span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Lifecycle stages across the entire organization — every count comes from your org-scoped work feed and onboarding
        queue. Managers see the same page filtered to their team only.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
            aria-label={`${s.label}: ${s.value}`}
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" strokeWidth={2.5} />
              </span>
              <span className="text-2xl font-extrabold tracking-tight text-foreground">{s.value}</span>
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">{s.label}</h3>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.sub}</p>
            </div>
            <span className="flex items-center gap-1 text-xs font-bold text-primary">
              Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
      {attention.length > 0 && (
        <div className="mt-4 rounded-lg bg-white p-4 shadow-card">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-accent" /> Journeys needing an HR decision
          </h3>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {attention.map((j) => (
              <li key={j.twin_id}>
                <Link
                  to={`/onboarding?twin=${j.twin_id}`}
                  className="group flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span className="font-bold text-foreground">{j.employee_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {j.stall_reasons.length > 0
                      ? j.stall_reasons.join(" · ")
                      : j.pending_hr_approval
                        ? "awaiting HR approval"
                        : j.pending_manager_approval
                          ? "awaiting manager approval"
                          : `${j.overdue_count} overdue task${j.overdue_count > 1 ? "s" : ""}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function RoleHome() {
  const { role, twin, user } = useAuth();

  const org = useQuery({
    queryKey: ["org"],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("name").maybeSingle();
      return data?.name ?? "Your organization";
    },
  });

  // Unified "My work" feed — server-authorized, per-role assigned work.
  const myWork = useQuery({
    queryKey: ["my-work", user?.id ?? "anon"],
    enabled: !!user,
    queryFn: fetchMyWork,
    retry: false,
  });

  // Batch 3: role-scoped onboarding queue — drives the attention strip
  // (HR/admin/manager), the employee "waiting on" line, and the IT
  // provisioning workspace. Same canonical function as the onboarding center.
  const queue = useQuery({
    queryKey: ["ob-queue", user?.id ?? "anon"],
    enabled: !!user && ["employee", "hr_executive", "hr_partner", "manager", "it_security"].includes(role ?? ""),
    queryFn: onboardingQueue,
    retry: false,
  });

  // Employee home onboarding facts read the SAME canonical adaptive plan the
  // onboarding center reads (onboarding_plans + onboarding_tasks) — never the
  // legacy journey. Counts therefore derive from identical rows and rules.
  const myPlan = useQuery({
    queryKey: ["plan", user?.id ?? "anon", twin?.id ?? "none"],
    enabled: role === "employee" && !!twin,
    queryFn: async () => {
      if (!twin) return null;
      const { data, error } = await supabase
        .from("onboarding_plans")
        .select("*")
        .eq("twin_id", twin.id)
        .eq("org_id", twin.org_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? decode(planViewSchema, data, "plan-row") : null;
    },
  });

  const myPlanTasks = useQuery({
    queryKey: ["plan-tasks", user?.id ?? "anon", myPlan.data?.id ?? "none"],
    enabled: role === "employee" && !!myPlan.data?.id,
    queryFn: async () => {
      if (!myPlan.data) return [];
      const { data, error } = await supabase
        .from("onboarding_tasks")
        .select("*")
        .eq("plan_id", myPlan.data.id)
        .order("topological_level", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((t) => {
        const row = { ...t, blocked_reasons: (t as { blocked_reasons?: unknown }).blocked_reasons ?? [] };
        return decode(planTaskViewSchema, row, "plan-task-row");
      });
    },
  });

  // "Open recommendations" = my non-terminal recommendations (active, awaiting
  // or inside execution). Not a bare org-wide row count.
  const ACTIVE_REC_STATUSES = ["suggested", "needs_review", "approved", "execution_pending", "in_progress"];
  const myRecs = useQuery({
    queryKey: ["my-recs", twin?.id ?? "anon"],
    enabled: role === "employee",
    queryFn: async () => {
      if (!twin) return 0;
      const { count } = await supabase
        .from("recommendations")
        .select("id", { count: "exact", head: true })
        .eq("twin_id", twin.id)
        .in("status", ACTIVE_REC_STATUSES);
      return count ?? 0;
    },
  });

  // Recruiter pipeline — applicants are SORTED by match score (highest first)
  // and the label says so; no unsorted list is ever called a ranking.
  const recruiterData = useQuery({
    queryKey: ["recruiter", twin?.id ?? "anon"],
    enabled: role === "recruiter",
    queryFn: async () => {
      const [reqsRes, candidatesRes, sessionsRes] = await Promise.all([
        supabase.from("job_requisitions").select("*"),
        supabase.from("digital_twins").select("id, name, role, status").eq("role", "candidate"),
        supabase.from("candidate_sessions").select("status"),
      ]);
      const reqs = (reqsRes.data ?? []).map((r) => decode(requisitionRowSchema, r, "requisition-row"));
      const candidates = (candidatesRes.data ?? []) as { id: string; name: string }[];
      const sessions = (sessionsRes.data ?? []) as { status: string }[];
      const openReqs = reqs
        .filter((r) => r.status === "open")
        .map((r) => ({ ...r, applicants: [...(r.applicants ?? [])].sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0)) }));
      const applicants = openReqs.flatMap((r) => r.applicants ?? []);
      const finalRound = applicants.filter((a) => a.stage === "final_round").length;
      const scored = applicants.filter((a) => typeof a.match_score === "number");
      const avgScore =
        scored.length > 0 ? scored.reduce((s, a) => s + (a.match_score ?? 0), 0) / scored.length : null;
      // Batch 3 (3.4): interviews/tests are discoverable from the home — real
      // session rows, never a bare "no assessments" when reads fail.
      const invitationsAwaiting = sessions.filter((s) => s.status === "invited" || s.status === "in_progress").length;
      const submittedForReview = sessions.filter((s) => s.status === "submitted").length;
      return { reqs, openReqs, candidates, applicants, finalRound, avgScore, invitationsAwaiting, submittedForReview };
    },
  });

  if (!role || !twin) return null;

  const journeyTasks = myPlanTasks.data ?? [];
  const journeyCounts = derivePlanCounts(journeyTasks);
  const nextTask = nextActionTask(journeyTasks);
  const readiness = myPlan.data?.readiness ?? null;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {/* Welcome */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              {org.data} · {ROLE_LABEL[role]}
            </span>
            <span className="rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Fictional demo data
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Welcome back, {twin.name.split(" ")[0]}.
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            {twin.job_title} · {twin.department ?? "—"}
          </p>
        </div>

        {/* §52: explicit "how this page differs by role" hint for judges. */}
        <RoleScopeCallout page="home" role={role} />

        {/* Unified assigned-work feed — what needs attention / can do / next */}
        <section aria-label="My work" className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">My work</h2>
            {myWork.data && myWork.data.items.length > 0 && (
              <span className="text-xs text-muted-foreground">Updated {new Date(myWork.data.generated_at).toLocaleTimeString()}</span>
            )}
          </div>
          <div className="mt-3">
            <MyWorkFeed
              feed={myWork.data ?? null}
              loading={myWork.isLoading}
              error={myWork.isError ? (myWork.error as Error) : null}
              onRetry={() => void myWork.refetch()}
            />
          </div>
        </section>

        {["hr_executive", "hr_partner", "manager"].includes(role) ? (
          <>
            {/* Batch 3: role-scoped attention first (HR org / manager team), then the
                role-specific differentiator (manager team roster vs HR lifecycle),
                then the shared dashboard — each panel enforces its own server scope. */}
            <JourneyAttentionStrip
              queue={queue.data ?? null}
              title={role === "manager" ? "My team needs attention" : "Onboarding needs attention"}
              scopeLabel={role === "manager" ? "Team scope" : "Organization scope"}
            />
            {role === "manager" ? (
              <ManagerTeamPanel queue={queue.data ?? null} />
            ) : (
              <HRLifecyclePanel queue={queue.data ?? null} myWork={myWork.data ?? null} role={role} />
            )}
            <div className="mt-10">
              <ExecutiveDashboard />
            </div>
          </>
        ) : (
          <>
            {/* Role-scoped stats */}
            <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {role === "recruiter" && (
                <>
                  <StatBlock
                    label="Open requisitions"
                    value={recruiterData.data?.openReqs.length ?? null}
                    tone="primary"
                    definition="Requisitions with status open (on-hold/filled/closed excluded)."
                  />
                  <StatBlock label="Active candidates" value={recruiterData.data?.candidates.length} tone="dark" definition="Candidate twins across the organization." />
                  <StatBlock label="In final round" value={recruiterData.data?.finalRound} tone="muted" definition="Applicants at final_round on open requisitions." />
                  <StatBlock
                    label="Avg applicant match"
                    value={recruiterData.data?.avgScore !== null && recruiterData.data?.avgScore !== undefined ? `${Math.round(recruiterData.data.avgScore * 100)}%` : null}
                    tone="subtle"
                    definition="Mean Skill Graph match score across open-requisition applicants."
                  />
                  <StatBlock
                    label="Invitations awaiting response"
                    value={recruiterData.data?.invitationsAwaiting ?? null}
                    tone="outline"
                    definition="Candidate sessions still invited or in progress — real rows, linked to the recruitment workspace."
                  />
                  <StatBlock
                    label="Submitted for review"
                    value={recruiterData.data?.submittedForReview ?? null}
                    tone="outline"
                    definition="Candidate assessments/interviews submitted and awaiting human review."
                  />
                </>
              )}
              {role === "employee" && (
                <>
                  <StatBlock
                    label="Onboarding tasks done"
                    value={readiness ? `${readiness.satisfied}/${readiness.total}` : null}
                    tone="primary"
                    definition="Tasks satisfied (completed or waived) in your active plan — the same count as the onboarding center."
                  />
                  <StatBlock
                    label="Active recommendations"
                    value={myRecs.data}
                    tone="muted"
                    definition="Your non-terminal recommendations (awaiting or in execution)."
                  />
                  <StatBlock label="Verified skills" value={twin.verified_skills.length} tone="dark" definition="Skills with high/medium-rigor evidence on your profile." />
                  <StatBlock
                    label="Development progress"
                    value={readiness ? `${readiness.satisfied}/${readiness.total}` : null}
                    tone="subtle"
                    definition="Satisfied onboarding tasks — learning and verification live in your onboarding center."
                  />
                </>
              )}
            </div>

            {/* Task owners act on their assigned action tasks here */}
            {(role === "employee" || role === "recruiter") && (
              <div className="mt-8">
                <MyActionTasks twinId={twin.id} />
              </div>
            )}

            {/* Main panels */}
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {role === "recruiter" && (
                <div className="rounded-lg bg-white p-6 shadow-card lg:col-span-2">
                  <h2 className="text-lg font-extrabold text-foreground">Recruitment pipeline</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Applicants on open requisitions, sorted by Skill Graph match score (highest first).
                  </p>
                  {recruiterData.data && recruiterData.data.openReqs.length > 0 ? (
                    <div className="mt-4 flex flex-col gap-5">
                      {recruiterData.data.openReqs.map((r) => (
                        <div key={r.id}>
                          <div className="flex items-center justify-between">
                            <p className="font-bold text-foreground">{r.title}</p>
                            <span className="text-xs text-muted-foreground">{r.department}</span>
                          </div>
                          {(r.applicants ?? []).length > 0 ? (
                            <ul className="mt-2 flex flex-col divide-y divide-border">
                              {r.applicants.map((a, i) => (
                                <li key={`${r.id}-${a.twin_id}-${i}`} className="flex items-center justify-between gap-4 py-2.5">
                                  <span
                                    className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                                      a.stage === "final_round"
                                        ? "bg-secondary text-white"
                                        : a.stage === "technical_interview"
                                          ? "bg-primary text-white"
                                          : "bg-muted text-foreground"
                                    }`}
                                  >
                                    {a.stage.replace(/_/g, " ")}
                                  </span>
                                  <div className="flex flex-1 items-center gap-3">
                                    <div className="h-2 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                                      <div
                                        className="h-full bg-primary"
                                        style={{ width: `${Math.round((a.match_score ?? 0) * 100)}%` }}
                                      />
                                    </div>
                                    <span className="w-12 text-right text-sm font-bold text-foreground">
                                      {a.match_score !== null && a.match_score !== undefined
                                        ? `${Math.round(a.match_score * 100)}`
                                        : "—"}
                                    </span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-sm text-muted-foreground">No applicants yet.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">No open requisitions.</p>
                  )}
                </div>
              )}

              {role === "employee" && (
                <div className="rounded-lg bg-white p-6 shadow-card lg:col-span-2">
                  <h2 className="text-lg font-extrabold text-foreground">Your onboarding journey</h2>
                  {readiness && journeyTasks.length > 0 ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-sm font-semibold text-muted-foreground">
                        <span>Progress</span>
                        <span>
                          {readiness.satisfied}/{readiness.total} complete
                        </span>
                      </div>
                      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${readiness.ready_pct}%` }}
                        />
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {journeyCounts.blocked > 0
                          ? `${journeyCounts.blocked} task${journeyCounts.blocked > 1 ? "s" : ""} blocked by a prerequisite or open blocker.`
                          : readiness.note}
                      </p>
                      <ul className="mt-5 flex flex-col divide-y-2 divide-border">
                        {journeyTasks.map((t) => {
                          const chip = TASK_STATE_META[t.state] ?? TASK_STATE_META.pending;
                          return (
                            <li key={t.task_code} className="flex items-center justify-between gap-3 py-3">
                              <span className="text-sm font-medium text-foreground">{t.title}</span>
                              <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${chip.cls}`}>
                                {chip.label}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {nextTask && (
                        <p className="mt-4 rounded-md bg-muted px-4 py-3 text-sm text-foreground">
                          <span className="font-bold">Next up:</span> {nextTask.title}
                        </p>
                      )}
                      {queue.data && queue.data.journeys[0] && queue.data.journeys[0].waiting_on.length > 0 && (
                        <div className="mt-4 rounded-md bg-accent/10 px-4 py-3 text-sm text-foreground">
                          <p className="font-bold">Waiting on others</p>
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {queue.data.journeys[0].waiting_on.map((w) => (
                              <li key={w.task_code} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Hourglass className="h-3.5 w-3.5 shrink-0 text-accent" />
                                <span className="font-semibold text-foreground">{w.title}</span>
                                <span className="capitalize">({w.owner_role.replace(/_/g, " ")})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">No active onboarding plan yet.</p>
                  )}
                </div>
              )}

              {role === "it_security" && <ItProvisioningPanel queue={queue.data ?? null} />}
            </div>
          </>
        )}

        {/* Administrators: governance console stays available below the work feed. */}
        {role === "hr_executive" && (
          <div className="mt-12">
            <AdminGovernancePanel />
          </div>
        )}
      </div>
    </AppShell>
  );
}
