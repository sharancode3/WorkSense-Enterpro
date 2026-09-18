import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  GitBranch,
  Layers,
  Lightbulb,
  Loader2,
  Lock,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommentsPanel } from "@/components/recommendation-comments";
import { can } from "@/lib/rbac";
import { mergeDecisionHistory } from "@/lib/decision-history";
import {
  actionTaskUpdate,
  recommendationExecute,
  recommendationReview,
  recommendationScan,
  type ActionTaskRow,
  type RecommendationRow,
  type WorkflowEventRow,
} from "@/lib/api";
import { decode, recommendationRowSchema } from "@/lib/contracts";

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  suggested: { label: "Suggested", cls: "bg-muted text-foreground" },
  needs_review: { label: "Needs review", cls: "bg-accent text-foreground" },
  approved: { label: "Approved", cls: "bg-primary text-white" },
  rejected: { label: "Rejected", cls: "bg-destructive text-white" },
  execution_pending: { label: "Execution pending", cls: "bg-foreground text-white" },
  in_progress: { label: "In progress", cls: "bg-secondary text-white" },
  completed: { label: "Completed", cls: "bg-secondary text-white" },
  verified: { label: "Verified — outcome recorded", cls: "bg-primary text-white" },
  failed: { label: "Failed", cls: "bg-destructive text-white" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-foreground" },
  stale: { label: "Stale — re-review", cls: "bg-destructive text-white" },
};

const TASK_STATUS_CHIP: Record<string, string> = {
  open: "bg-muted text-foreground",
  in_progress: "bg-primary text-white",
  blocked: "bg-accent text-foreground",
  completed: "bg-secondary text-white",
  failed: "bg-destructive text-white",
  cancelled: "bg-muted text-foreground",
};

const URGENCY_CLS: Record<string, string> = {
  critical: "bg-destructive text-white",
  high: "bg-destructive text-white",
  medium: "bg-accent text-foreground",
  low: "bg-muted text-foreground",
};

const CATEGORY_LABEL: Record<string, string> = {
  workforce_review: "Workforce Review · Review Conversation",
  mobility: "Internal Mobility",
  development_support: "Development Support",
  upskilling: "Upskilling",
  recruitment_review: "Recruitment · Assessment Gaps",
  recruitment: "Recruitment",
  onboarding_replan: "Onboarding Replan",
  policy: "Policy Question Escalation",
};

type DialogState =
  | { kind: "rec"; rec: RecommendationRow; action: string; fn: "review" | "execute" }
  | { kind: "task"; task: ActionTaskRow; action: string }
  | null;

const REC_ACTIONS: Record<string, { action: string; label: string; fn: "review" | "execute"; variant?: "outline" | "secondary" | "default" }[]> = {
  suggested: [{ action: "submit", label: "Submit for review", fn: "review" }],
  needs_review: [
    { action: "approve", label: "Approve", fn: "review" },
    { action: "reject", label: "Reject", fn: "review", variant: "outline" },
  ],
  stale: [
    { action: "re_review", label: "Re-review", fn: "review" },
    { action: "reject", label: "Reject", fn: "review", variant: "outline" },
  ],
  approved: [{ action: "dispatch", label: "Dispatch — create tasks", fn: "execute" }],
  execution_pending: [
    { action: "start", label: "Start execution", fn: "execute" },
    { action: "cancel", label: "Cancel", fn: "execute", variant: "outline" },
  ],
  in_progress: [
    { action: "complete", label: "Mark completed", fn: "execute" },
    { action: "fail", label: "Mark failed", fn: "execute", variant: "outline" },
    { action: "cancel", label: "Cancel", fn: "execute", variant: "outline" },
  ],
  failed: [
    { action: "start", label: "Retry", fn: "execute" },
    { action: "cancel", label: "Cancel", fn: "execute", variant: "outline" },
  ],
  completed: [
    { action: "verify", label: "Verify outcome", fn: "execute" },
  ],
  verified: [],
  rejected: [],
  cancelled: [],
};

const TASK_ACTIONS: Record<string, { action: string; label: string; variant?: "outline" | "secondary" | "default" }[]> = {
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

interface RecResolvers {
  subject: { name: string; role: string; jobTitle: string | null } | null;
  target: { title: string; department: string | null } | null;
  actorName: (twinId: string) => string | null;
}

function TasksPanel({ rec, onTaskAct }: { rec: RecommendationRow; onTaskAct: (task: ActionTaskRow, action: string) => void }) {
  const { user } = useAuth();
  const tasks = useQuery({
    queryKey: ["rec-tasks", user?.id ?? "anon", rec.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("action_tasks")
        .select("*")
        .eq("recommendation_id", rec.id)
        .order("created_at", { ascending: true });
      return (data ?? []) as ActionTaskRow[];
    },
  });

  const events = useQuery({
    queryKey: ["rec-events", user?.id ?? "anon", rec.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("workflow_events")
        .select("*")
        .eq("resource_type", "recommendation")
        .eq("resource_id", rec.id)
        .order("created_at", { ascending: true });
      return (data ?? []) as WorkflowEventRow[];
    },
  });

  // Batch C (C3): the canonical decision history is the workflow_events trail —
  // pre-execution (submit/approve/reject/re-review) AND execution transitions.
  // The legacy audit_events jsonb only contributes the scan-time creation
  // record; transition-shaped legacy entries are deduplicated by the helper.
  const history = useMemo(
    () => mergeDecisionHistory(events.data ?? [], rec.audit_events),
    [events.data, rec.audit_events]
  );

  return (
    <div className="mt-5">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <UserCheck className="h-4 w-4" /> Action tasks ({tasks.data?.length ?? 0}) — created at dispatch, executed by owners
      </p>
      {tasks.data && tasks.data.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {tasks.data.map((t) => {
            const chip = TASK_STATUS_CHIP[t.status] ?? "bg-muted text-foreground";
            return (
              <div key={t.id} className="rounded-md bg-muted p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.owner_role ?? "assigned"} · due {t.due_at ? new Date(t.due_at).toLocaleDateString() : "—"}
                      {t.retry_count > 0 ? ` · ${t.retry_count} retr${t.retry_count > 1 ? "ies" : "y"}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${chip}`}>{t.status.replace(/_/g, " ")}</span>
                </div>
                {t.instructions && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.instructions}</p>}
                {t.resource_link && (
                  <p className="mt-1 text-xs">
                    {/worksense\.demo|learning\.worksense/i.test(t.resource_link) ? (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground" title="Placeholder resource — replace with the real catalog link before linking owners to it">
                        Resource: {t.resource_link} (placeholder — replace with the real L&D catalog link)
                      </span>
                    ) : (
                      <span className="text-primary">Resource: {t.resource_link}</span>
                    )}
                  </p>
                )}
                {(t.required_evidence ?? []).length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Required evidence: {(t.required_evidence ?? []).join(", ")}</p>
                )}
                {t.status === "failed" && t.last_error && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t.last_error}
                  </p>
                )}
                {t.verification?.evidence && t.verification.evidence.length > 0 && (
                  <p className="mt-1.5 text-xs text-foreground">Evidence: {t.verification.evidence.join(", ")}</p>
                )}
                {TASK_ACTIONS[t.status] && TASK_ACTIONS[t.status].length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {TASK_ACTIONS[t.status].map((a) => (
                      <Button key={a.action} size="sm" variant={a.variant ?? "default"} onClick={() => onTaskAct(t, a.action)}>
                        {a.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">No tasks yet — dispatch creates them in the same transaction.</p>
      )}

      <div className="mt-3">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Decision history ({history.length})</p>
        <ul className="mt-1.5 flex flex-col divide-y divide-border rounded-md border border-border">
          {history.map((e) => (
            <li key={e.key} className="px-3 py-2 text-xs">
              <span className="font-semibold text-foreground">
                {e.kind === "creation" ? e.actionLabel : `${e.actor} · ${e.actionLabel}`}
              </span>
              <span className="ml-1 text-muted-foreground">
                · {e.detail} · {new Date(e.timestamp).toLocaleString()}
              </span>
              {e.message && <p className="mt-0.5 italic text-foreground">Note: {e.message}</p>}
              {e.evidence && e.evidence.length > 0 && (
                <p className="mt-0.5 text-foreground">Outcome evidence: {e.evidence.join(" · ")}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RecommendationCard({
  rec,
  resolvers,
  onAct,
  onTaskAct,
  busy,
}: {
  rec: RecommendationRow;
  resolvers: RecResolvers;
  onAct: (rec: RecommendationRow, action: string, fn: "review" | "execute") => void;
  onTaskAct: (task: ActionTaskRow, action: string) => void;
  busy: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const chip = STATUS_CHIP[rec.status] ?? STATUS_CHIP.suggested;
  const actions = REC_ACTIONS[rec.status] ?? [];
  const { subject, target, actorName } = resolvers;

  return (
    <div className="rounded-lg bg-white p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>
            <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${URGENCY_CLS[rec.urgency] ?? "bg-muted text-foreground"}`}>{rec.urgency}</span>
            {rec.stale && (
              <span className="flex items-center gap-1 rounded-md bg-destructive px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                <AlertTriangle className="h-3 w-3" /> source changed — re-review required
              </span>
            )}
          </div>
          <h3 className="mt-2 text-lg font-extrabold tracking-tight text-foreground">{CATEGORY_LABEL[rec.category] ?? rec.category.replace(/_/g, " ")}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {/* Batch C (C1): the subject is a resolved person, never a sliced id. */}
            {subject ? (
              <>
                Subject: <b className="text-foreground">{subject.name}</b> ({subject.role.replace("_", " ")}
                {subject.jobTitle ? ` · ${subject.jobTitle}` : ""})
              </>
            ) : (
              "Subject: —"
            )}
            {target ? (
              <>
                {" "}· Target: <b className="text-foreground">{target.title}</b>
                {target.department ? ` (${target.department})` : ""}
              </>
            ) : null}
            <br />
            Requires sign-off: {rec.required_signoff_role?.replace("_", " ") ?? "—"} · {new Date(rec.created_at).toLocaleDateString()} · v{rec.version}
          </p>
        </div>
        <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-bold text-foreground">{rec.proposed_action.title}</span>
      </div>

      {rec.stale && rec.stale_reason && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {rec.stale_reason}
        </p>
      )}

      {rec.alternatives && rec.alternatives.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Alternatives considered</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {rec.alternatives.map((a) => `${a.title} (${Math.round(a.fit_score * 100)}% fit, ${Math.round(a.coverage * 100)}% coverage)`).join(" · ")}
          </p>
        </div>
      )}

      {/* Evidence + reasoning — collapsed until requested (Phase 11 item 3) */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="mt-4 flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <FileSearch className="h-4 w-4" /> Evidence, reasoning & sources ({rec.evidence_ledger.length})
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${showDetails ? "rotate-180" : ""}`} />
      </button>
      {showDetails && (
        <>
          {/* Evidence */}
          <div className="mt-3">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <FileSearch className="h-4 w-4" /> Evidence — every source with a concrete fact
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {rec.evidence_ledger.map((e) => (
                <div key={e.source} className="rounded-md bg-muted p-3">
                  <span className="inline-block rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">{e.source}</span>
                  <p className="mt-1.5 text-sm leading-snug text-foreground">{e.fact}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Reasoning */}
          <div className="mt-4 rounded-lg bg-primary/5 p-4">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
              <Lightbulb className="h-4 w-4" /> Reasoning
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground">{rec.executive_summary || rec.proposed_action.executive_summary || "No synthesis available."}</p>
          </div>
        </>
      )}

      {/* Recommended action */}
      <div className="mt-4">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Layers className="h-4 w-4" /> Recommended action
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">{rec.proposed_action.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{rec.proposed_action.description}</p>
        {rec.proposed_action.steps.length > 0 && (
          <ol className="mt-2 flex flex-col gap-1.5">
            {rec.proposed_action.steps.map((s) => (
              <li key={s.order} className="flex items-center gap-2 text-sm text-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-foreground text-[10px] font-bold text-white">{s.order}</span>
                {s.action}
              </li>
            ))}
          </ol>
        )}
        {rec.intended_outcome?.outcome && <p className="mt-2 text-xs italic text-muted-foreground">Intended outcome: {rec.intended_outcome.outcome}</p>}
      </div>

      {/* Outcomes (completed/failed) */}
      {(rec.status === "completed" || rec.status === "failed" || rec.status === "cancelled") && (
        <div className="mt-4 rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">
          {rec.outcomes?.time_to_ready_days !== undefined && <p>Time to ready: {rec.outcomes.time_to_ready_days} day(s).</p>}
          {rec.outcomes?.task_summary && (
            <p>Tasks: {rec.outcomes.task_summary.completed}/{rec.outcomes.task_summary.total} completed, {rec.outcomes.task_summary.failed} failed, {rec.outcomes.task_summary.cancelled} cancelled.</p>
          )}
          {rec.outcomes?.reviewer_feedback && <p className="italic">Reviewer feedback: {rec.outcomes.reviewer_feedback}</p>}
          {rec.outcomes?.note && <p className="italic">{rec.outcomes.note}</p>}
        </div>
      )}

      {/* Tasks + canonical decision history (all lifecycle states) */}
      <TasksPanel rec={rec} onTaskAct={onTaskAct} />

      {/* Human decision */}
      {actions.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t-2 border-border pt-4">
          <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> A short typed rationale is required before the state can change.
          </span>
          {actions.map((a) => (
            <Button key={a.action} size="sm" variant={a.variant ?? "default"} onClick={() => onAct(rec, a.action, a.fn)} disabled={busy}>
              {a.label} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      )}

      {/* Batch C (C2): persisted comments with visibility permissions. */}
      <CommentsPanel recId={rec.id} actorNames={actorName} />
    </div>
  );
}

const PAGE_SIZE = 10;

export default function RecommendationHub() {
  const { role, user, twin } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const focusRec = searchParams.get("rec");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [page, setPage] = useState(0);

  // Subject + target resolution (Batch C, C1): names/titles come from the org
  // rosters and requisitions, never from sliced ids. RLS scopes both queries.
  const twinsQ = useQuery({
    queryKey: ["hub-twins", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("digital_twins")
        .select("id, name, role, job_title");
      return (data ?? []) as { id: string; name: string; role: string; job_title: string | null }[];
    },
  });
  const reqsQ = useQuery({
    queryKey: ["hub-requisitions", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_requisitions")
        .select("id, title, department");
      return (data ?? []) as { id: string; title: string; department: string | null }[];
    },
  });

  const twinsById = useMemo(() => new Map((twinsQ.data ?? []).map((t) => [t.id, t])), [twinsQ.data]);
  const reqsById = useMemo(() => new Map((reqsQ.data ?? []).map((r) => [r.id, r])), [reqsQ.data]);

  const resolveSubject = (rec: RecommendationRow) => {
    if (!rec.twin_id) return null;
    const t = twinsById.get(rec.twin_id);
    return t ? { name: t.name, role: t.role, jobTitle: t.job_title } : null;
  };
  const resolveTarget = (rec: RecommendationRow) => {
    if (!rec.resource_ref) return null;
    const r = reqsById.get(rec.resource_ref);
    return r ? { title: r.title, department: r.department } : null;
  };
  const actorName = (twinId: string) => twinsById.get(twinId)?.name ?? null;

  // Batch C (C4): honest pagination — the server returns the exact count under
  // the same filters and RLS, and the page slice is fetched server-side, so the
  // count is never a "latest 20" approximation and filters are not local-only.
  const recs = useQuery({
    queryKey: ["hub-recs", user?.id ?? "anon", statusFilter, categoryFilter, ownerFilter, page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let countQ = supabase.from("recommendations").select("id", { count: "exact", head: true });
      if (statusFilter !== "all") countQ = countQ.eq("status", statusFilter);
      if (categoryFilter !== "all") countQ = countQ.eq("category", categoryFilter);
      if (ownerFilter !== "all") countQ = countQ.eq("required_signoff_role", ownerFilter);

      let dataQ = supabase
        .from("recommendations")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);
      if (statusFilter !== "all") dataQ = dataQ.eq("status", statusFilter);
      if (categoryFilter !== "all") dataQ = dataQ.eq("category", categoryFilter);
      if (ownerFilter !== "all") dataQ = dataQ.eq("required_signoff_role", ownerFilter);

      const [{ count }, { data, error }] = await Promise.all([countQ, dataQ]);
      if (error) throw error;
      return {
        total: count ?? 0,
        items: (data ?? []).map((r) => decode(recommendationRowSchema, r, "recommendation-row")),
      };
    },
  });

  // Clamp out-of-range pages (e.g. a filter now matches fewer rows).
  useEffect(() => {
    const total = recs.data?.total ?? 0;
    if (total > 0 && page > 0 && page * PAGE_SIZE >= total) {
      setPage(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
    }
  }, [recs.data?.total, page]);

  useEffect(() => {
    if (!focusRec || !recs.data) return;
    const el = document.getElementById(`rec-${focusRec}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-4", "ring-primary/40");
      const t = setTimeout(() => el.classList.remove("ring-4", "ring-primary/40"), 2500);
      return () => clearTimeout(t);
    }
  }, [focusRec, recs.data]);

  if (role && !can(role, "approve_recommendations")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Approval access only</h1>
          <p className="text-muted-foreground">The Recommendation Hub is for Managers, HR Business Partners and Administrators. Task owners act on their own tasks from their home screen.</p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["hub-recs", user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["rec-tasks", user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["rec-events", user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["rec-comments"] });
    void qc.invalidateQueries({ queryKey: ["dashboard", user?.id ?? "anon"] });
  };

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await recommendationScan();
      toast.success(
        res.created > 0
          ? `Scan created ${res.created} new suggestion(s): ${res.created_ids.join(", ")}${res.made_stale > 0 ? ` · marked ${res.made_stale} stale (source changed)` : ""}`
          : `Scan found no new suggestions (${res.unchanged} unchanged, ${res.made_stale} made stale).`
      );
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const confirm = async () => {
    if (!dialog || rationale.trim().length < 5) return;
    setBusy(true);
    try {
      const note = message.trim() || undefined;
      if (dialog.kind === "rec") {
        // Verify outcome requires accepted evidence references (Batch A4).
        if (dialog.action === "verify") {
          const evs = evidence.split("\n").map((s) => s.trim()).filter(Boolean);
          if (evs.length === 0) {
            toast.error("Outcome verification requires at least one evidence reference.");
            return;
          }
          const res = await recommendationExecute(dialog.rec.id, dialog.action, rationale.trim(), undefined, undefined, evs, note);
          toast.success(res.effect ? `Status: ${res.status.replace(/_/g, " ")} — ${res.effect}` : `Status: ${res.status.replace(/_/g, " ")}`);
        } else {
          const res =
            dialog.fn === "review"
              ? await recommendationReview(dialog.rec.id, dialog.action, rationale.trim(), undefined, undefined, note)
              : await recommendationExecute(dialog.rec.id, dialog.action, rationale.trim(), undefined, undefined, undefined, note);
          toast.success(
            res.effect
              ? `Status: ${res.status.replace(/_/g, " ")} — ${res.effect}`
              : `Status: ${res.status.replace(/_/g, " ")}`
          );
        }
      } else {
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
            ? `Task ${res.status.replace(/_/g, " ")} — recommendation is now ${res.recommendation_status.replace(/_/g, " ")}`
            : `Task ${res.status.replace(/_/g, " ")}`
        );
      }
      setDialog(null);
      setRationale("");
      setMessage("");
      setEvidence("");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const taskOwnerLabel = (task: ActionTaskRow) =>
    task.owner_twin_id === twin?.id ? " (you)" : "";

  const total = recs.data?.total ?? 0;
  const pageRecs = recs.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Recommendation & Action Hub</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Evidence. Reasoning. <span className="text-primary">A human decides.</span>
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Every recommendation moves through an enforced lifecycle — suggested → needs review → approved/rejected →
            execution → outcome — with optimistic concurrency (a stale snapshot is rejected) and idempotent retries
            (double clicks never duplicate tasks). The model writes the reasoning; the facts, transitions and state are
            deterministic. Workforce interventions record observations, never causality.
          </p>
        </div>

        {(role === "hr_executive" || role === "hr_partner") && (
          <div className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-foreground p-5 text-white">
            <p className="flex items-center gap-2 text-sm text-white/80">
              <GitBranch className="h-5 w-5 text-secondary" strokeWidth={2.5} />
              Re-scan the org's data. Unchanged cases are skipped; changed evidence marks old suggestions stale for re-review.
            </p>
            <Button onClick={() => void runScan()} disabled={scanning} variant="secondary" size="sm">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Run intelligence scan
            </Button>
          </div>
        )}

        {/* Filters + pagination — the count shown is the exact server count
            under the same filters (Batch C, C4), not a local approximation. */}
        <div className="mt-8 flex flex-wrap items-center gap-2 rounded-lg bg-white p-3">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} aria-label="Filter by status" className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none">
            <option value="all">All statuses</option>
            {Object.entries(STATUS_CHIP).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }} aria-label="Filter by type" className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none">
            <option value="all">All types</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); setPage(0); }} aria-label="Filter by sign-off owner" className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none">
            <option value="all">All sign-off owners</option>
            <option value="manager">Manager</option>
            <option value="hr_executive">HR Executive</option>
            <option value="recruiter">Recruiter</option>
          </select>
          <span className="ml-auto text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {total} shown
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-6">
          {recs.isLoading && (
            <div className="flex items-center gap-3 rounded-lg bg-muted p-8 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading recommendations…
            </div>
          )}
          {recs.isError && (
            <div className="rounded-lg bg-destructive/10 p-6 text-sm text-destructive">
              <p className="font-bold">Could not load recommendations.</p>
              <p className="mt-1">{recs.error instanceof Error ? recs.error.message : "unknown error"}</p>
            </div>
          )}
          {!recs.isLoading && !recs.isError && total === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
              <MessageSquareText className="h-8 w-8 text-muted-foreground" strokeWidth={2} />
              <p className="text-sm text-muted-foreground">No recommendations yet — run the intelligence scan.</p>
            </div>
          )}
          {!recs.isLoading && !recs.isError && total > 0 && pageRecs.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">No recommendations match the current filters.</p>
            </div>
          )}
          {!recs.isLoading && !recs.isError && pageRecs.map((rec) => (
            <div key={rec.id} id={`rec-${rec.id}`} className="rounded-lg transition-all duration-500">
              <RecommendationCard
                rec={rec}
                resolvers={{
                  subject: resolveSubject(rec),
                  target: resolveTarget(rec),
                  actorName,
                }}
                busy={busy}
                onAct={(r, action, fn) => {
                  setDialog({ kind: "rec", rec: r, action, fn });
                  setRationale("");
                  setMessage("");
                  setEvidence("");
                }}
                onTaskAct={(task, action) => {
                  setDialog({ kind: "task", task, action });
                  setRationale("");
                  setMessage("");
                  setEvidence("");
                }}
              />
            </div>
          ))}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </Button>
              <span className="text-xs font-semibold text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>

        <p className="mt-8 rounded-lg bg-muted p-4 text-xs leading-relaxed text-muted-foreground">
          Dispatch creates the reviewed action tasks in the same transaction as the state change — a recommendation is
          never "execution pending" before its tasks exist. Task completions roll up into the recommendation outcome
          (time-to-ready, task summary, reviewer feedback).
        </p>
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialog?.kind === "rec" && dialog.action === "approve" && <CheckCircle2 className="h-5 w-5 text-secondary" />}
              {dialog?.kind === "rec" && dialog.action === "reject" && <XCircle className="h-5 w-5 text-destructive" />}
              {dialog?.kind === "rec" && dialog.action === "dispatch" && <AlertTriangle className="h-5 w-5 text-accent" />}
              {dialog?.kind === "task" && <UserCheck className="h-5 w-5 text-primary" />}
              {dialog
                ? `${dialog.kind === "task" ? `Task: ${dialog.task.title}` : dialog.action} — ${dialog.action.replace(/_/g, " ")}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          {dialog && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {dialog.kind === "rec" && dialog.action === "dispatch"
                  ? "Dispatching creates the reviewed action tasks (owner, due date, instructions, required evidence, outcome measure) in the same transaction as the state change."
                  : dialog.kind === "task" && dialog.action === "complete"
                    ? "Completing a task requires at least one evidence reference. The recommendation outcome view updates automatically."
                    : `The ${dialog.kind === "task" ? "task" : "recommendation"} will move through its enforced state machine.`}
              </p>

              {/* Phase 11 item 11-14: specific approval preview, not a vague approve-approve dialog */}
              {dialog.kind === "rec" && dialog.action === "approve" && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p className="font-bold text-foreground">What you are approving</p>
                  <p className="mt-1 text-foreground">
                    <b>{dialog.rec.proposed_action.title}</b> for{" "}
                    <b>{dialog.rec.category.replace(/_/g, " ")}</b>
                    {resolveSubject(dialog.rec) ? ` — subject ${resolveSubject(dialog.rec)!.name}` : ""}
                    {dialog.rec.resource_ref ? ` · target ${resolveTarget(dialog.rec)?.title ?? "requisition (not visible to you)"}` : ""}.
                  </p>
                  <p className="mt-1 text-muted-foreground">{dialog.rec.proposed_action.description}</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Planned tasks after dispatch</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {(dialog.rec.proposed_action.steps ?? []).map((s) => (
                      <li key={s.order} className="flex items-start gap-1.5 text-xs text-foreground">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-foreground text-[9px] font-bold text-white">{s.order}</span>
                        {s.action}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Approver: {dialog.rec.required_signoff_role?.replace(/_/g, " ") ?? "—"} · a typed justification is required below.
                    {dialog.rec.stale && <b className="text-destructive"> This case is STALE — approve is blocked; use Re-review first.</b>}
                  </p>
                </div>
              )}

              {dialog.kind === "rec" && dialog.action === "verify" && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p className="font-bold text-foreground">Verifying the outcome</p>
                  <p className="mt-1 text-muted-foreground">
                    Marking this recommendation <b>verified</b> records that the completed work produced traceable
                    outcome evidence. A task being created is never treated as success — verification is a separate,
                    explicit step.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Attach evidence references in the evidence box below.</p>
                </div>
              )}
              <Textarea
                rows={3}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Type your rationale (required)…"
              />
              {dialog.kind === "rec" && (
                <Textarea
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a note (optional) — recorded on the decision and visible to approvers…"
                  aria-label="Optional decision note"
                />
              )}
              {(dialog.kind === "task" && dialog.action === "complete") || (dialog.kind === "rec" && dialog.action === "verify") ? (
                <Textarea
                  rows={2}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="Evidence references (one per line) — required…"
                  aria-label="Evidence references"
                />
              ) : null}
              <Button
                onClick={() => void confirm()}
                disabled={
                  busy ||
                  rationale.trim().length < 5 ||
                  ((dialog.kind === "task" && dialog.action === "complete") || (dialog.kind === "rec" && dialog.action === "verify")) &&
                    evidence.trim().length === 0
                }
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Confirm {dialog.action.replace(/_/g, " ")}
              </Button>
              {dialog.kind === "task" && dialog.task.owner_twin_id === twin?.id && (
                <p className="text-xs text-muted-foreground">You are the owner of this task{taskOwnerLabel(dialog.task)}.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
