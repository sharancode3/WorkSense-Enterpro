import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  History,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserCog,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { ExecutiveDashboard } from "@/components/executive-dashboard";
import { MyWorkFeed } from "@/components/my-work-feed";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { can, ROLE_LABEL, type Role } from "@/lib/rbac";
import { actionTaskUpdate, fetchMyWork, type ActionTaskRow, type Twin } from "@/lib/api";
import { decode, planTaskViewSchema, planViewSchema, requisitionRowSchema, type RequisitionRow } from "@/lib/contracts";
import { nextActionTask, derivePlanCounts, TASK_STATE_META } from "@/lib/onboarding-progress";

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
      const [reqsRes, candidatesRes] = await Promise.all([
        supabase.from("job_requisitions").select("*"),
        supabase.from("digital_twins").select("id, name, role, status").eq("role", "candidate"),
      ]);
      const reqs = (reqsRes.data ?? []).map((r) => decode(requisitionRowSchema, r, "requisition-row"));
      const candidates = (candidatesRes.data ?? []) as { id: string; name: string }[];
      const openReqs = reqs
        .filter((r) => r.status === "open")
        .map((r) => ({ ...r, applicants: [...(r.applicants ?? [])].sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0)) }));
      const applicants = openReqs.flatMap((r) => r.applicants ?? []);
      const finalRound = applicants.filter((a) => a.stage === "final_round").length;
      const scored = applicants.filter((a) => typeof a.match_score === "number");
      const avgScore =
        scored.length > 0 ? scored.reduce((s, a) => s + (a.match_score ?? 0), 0) / scored.length : null;
      return { reqs, openReqs, candidates, applicants, finalRound, avgScore };
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
          <div className="mt-10">
            <ExecutiveDashboard />
          </div>
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
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">No active onboarding plan yet.</p>
                  )}
                </div>
              )}

              {role === "it_security" && (
                <div className="rounded-lg bg-muted p-6">
                  <ShieldCheck className="h-6 w-6 text-primary" strokeWidth={2.5} />
                  <h3 className="mt-3 text-base font-bold text-foreground">Provisioning service</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Laptop, SSO, and access tasks across authorized new hires appear in your work feed —
                    complete them with evidence in the onboarding center.
                  </p>
                </div>
              )}
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
