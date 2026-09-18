import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  GitBranch,
  GraduationCap,
  Hourglass,
  KeyRound,
  LayoutList,
  Loader2,
  Lock,
  Network,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  X,
  XCircle,
  ArrowRightLeft,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { can, ROLE_LABEL } from "@/lib/rbac";
import { filterItProvisioning, type ItQueueFilter } from "@/lib/it-provisioning";
import {
  onboardingPlanApprove,
  onboardingPlanBuild,
  onboardingQueue,
  onboardingTaskAction,
  type PlanTaskView,
  type PlanView,
} from "@/lib/api";
import {
  decode,
  planTaskViewSchema,
  planViewSchema,
  type QueueJourney,
  type QueueTaskRef,
} from "@/lib/contracts";
import { TASK_STATE_META } from "@/lib/onboarding-progress";

const OWNER_LABEL: Record<PlanTaskView["owner_role"], string> = {
  employee: "Employee",
  manager: "Manager",
  hr: "HR",
  it_security: "IT Security",
};

const TYPE_LABEL: Record<PlanTaskView["task_type"], string> = {
  learning: "Learning",
  verification: "Verification",
  provisioning: "Provisioning",
  policy: "Policy",
  access: "Access",
  onboarding_admin: "Admin",
};

const TYPE_ICON: Record<PlanTaskView["task_type"], typeof GraduationCap> = {
  learning: GraduationCap,
  verification: ClipboardCheck,
  provisioning: KeyRound,
  policy: ShieldCheck,
  access: KeyRound,
  onboarding_admin: FileCheck2,
};

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatusChip({ state }: { state: PlanTaskView["state"] }) {
  // Single source of task-state presentation, shared with the employee home.
  const chip = TASK_STATE_META[state] ?? TASK_STATE_META.pending;
  return <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>;
}

function WhyEvidence({ task }: { task: PlanTaskView }) {
  const [open, setOpen] = useState(false);
  const why = task.why_evidence;
  if (!why?.reason) return null;
  return (
    <div className="rounded-md bg-muted/60 px-2.5 py-2 text-[11px] leading-snug">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 font-semibold text-foreground hover:underline">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Why this task
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5 text-muted-foreground">
          <p>{why.reason}</p>
          {(why.source_evidence ?? []).map((s, i) => (
            <p key={i} className="rounded bg-background px-1.5 py-1">
              <span className="font-bold uppercase tracking-wider text-primary/80">{s.source_type}</span>: {s.fact}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const STEP_LABELS: Record<number, { n: string; label: string }> = {
  0: { n: "1", label: "Setup & Provisioning" },
  1: { n: "2", label: "System Access & SSO" },
  2: { n: "3", label: "Team Orientation" },
  3: { n: "4", label: "First Contribution" },
  4: { n: "5", label: "Final Verification" },
};
const stepFor = (level: number) =>
  STEP_LABELS[level] ?? { n: String(level + 1), label: `Additional Step ${level + 1}` };

function TaskCard({
  task,
  plan,
  viewer,
  canComplete,
  canWaive,
  canAdapt,
  canFail,
  canResolve,
  titleFor,
  onComplete,
  onBlock,
  onResolve,
  onWaive,
  onAdapt,
  onFail,
  busy,
}: {
  task: PlanTaskView;
  plan: PlanView;
  viewer: { id: string; role: string } | null;
  canComplete: boolean;
  canWaive: boolean;
  canAdapt: boolean;
  canFail: boolean;
  canResolve: boolean;
  titleFor: (code: string) => string;
  onComplete: (evidence: { kind: "note" | "assessment_id"; label: string; value: string }[], note?: string) => void;
  onBlock: (note: string) => void;
  onResolve: (blockerId: string) => void;
  onWaive: (reason: string, policyDoc: string) => void;
  onAdapt: (note: string) => void;
  onFail: (note: string) => void;
  busy: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [blockerOpen, setBlockerOpen] = useState(false);
  const [blockerText, setBlockerText] = useState("");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [evErrors, setEvErrors] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");
  const [waivePolicy, setWaivePolicy] = useState("");
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptNote, setAdaptNote] = useState("");
  const [failOpen, setFailOpen] = useState(false);
  const [failNote, setFailNote] = useState("");
  const Icon = TYPE_ICON[task.task_type];

  const openBlockers = (task.blockers ?? []).filter((b) => b.status === "open");

  const setEvidenceValue = (label: string, value: string) => {
    setEvidence((s) => ({ ...s, [label]: value }));
    if (value.trim()) setEvErrors((prev) => new Set([...prev].filter((l) => l !== label)));
  };

  const requiredEvidence = (task.evidence_requirements ?? []).filter((r) => r.required);
  const evidenceComplete = requiredEvidence.every((r) => (evidence[r.label] ?? "").trim().length > 0);

  const doComplete = () => {
    const ev = requiredEvidence.map((r) => ({ kind: r.kind as "note" | "assessment_id", label: r.label, value: (evidence[r.label] ?? "").trim() }));
    const missingLabels = new Set(ev.filter((e) => !e.value).map((e) => e.label));
    if (missingLabels.size > 0) {
      setEvErrors(missingLabels);
      toast.error("All required evidence fields must be filled before completing.");
      return;
    }
    onComplete(ev, note.trim() || undefined);
    setCompleteOpen(false);
    setEvidence({});
    setEvErrors(new Set());
    setNote("");
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-white p-4 transition-all duration-200 hover:scale-[1.01]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-sm font-bold leading-snug text-foreground">{task.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {TYPE_LABEL[task.task_type]}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {OWNER_LABEL[task.owner_role]}
              </span>
              {task.non_waivable && (
                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                  Mandatory Security Requirement
                </span>
              )}
            </div>
          </div>
        </div>
        <StatusChip state={task.state} />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1 font-medium text-foreground">
          <CalendarClock className="h-3 w-3" /> due {fmt(task.due_date)}
        </span>
        <span>{task.duration_days}d</span>
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-bold text-primary transition-opacity hover:opacity-80"
        aria-expanded={detailsOpen}
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? "rotate-90" : ""}`} />
        {detailsOpen ? "Hide details & evidence" : "View details & evidence"}
      </button>

      {detailsOpen && (task.depends_on ?? []).length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <GitBranch className="mr-1 inline h-3 w-3" />
          Prerequisite: {(task.depends_on ?? []).map((d) => (titleFor ? titleFor(d) : d)).join(", ")} must be completed first.
        </p>
      )}

      {(task.blocked_reasons ?? []).length > 0 && (
        <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          Waiting on: {task.blocked_reasons.join(", ")}
        </p>
      )}

      {openBlockers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {openBlockers.map((b) => (
            <div key={b.id} className="flex items-start justify-between gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive">
              <span>
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {b.note}
                <span className="block text-destructive/80">reported by {b.reported_by} · {fmt(b.at)}</span>
              </span>
              {canResolve && (
                <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[10px]" onClick={() => onResolve(b.id)} disabled={busy}>
                  Resolve
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {detailsOpen && (task.blockers ?? []).some((b) => b.status === "resolved") && (
        <div className="flex flex-col gap-1.5">
          {(task.blockers ?? [])
            .filter((b) => b.status === "resolved")
            .map((b) => (
              <div key={b.id} className="rounded-md bg-secondary/10 px-2 py-1.5 text-[11px] leading-snug">
                <span className="flex items-center gap-1 font-semibold text-secondary">
                  <CheckCircle2 className="h-3 w-3" /> Resolved: {b.note}
                </span>
                <span className="block text-muted-foreground">
                  reported by {b.reported_by} · resolved by {b.resolved_by ?? "—"} on {b.resolved_at ? fmt(b.resolved_at) : "—"}
                </span>
              </div>
            ))}
        </div>
      )}

      {detailsOpen && task.completion_record && (
        <div className="rounded-md bg-secondary/10 px-2 py-1.5 text-[11px] leading-snug">
          <p className="flex items-center gap-1 font-semibold text-secondary">
            <CheckCircle2 className="h-3 w-3" /> Completed by {task.completion_record.actor_name}
          </p>
          {(task.completion_record.evidence ?? []).length > 0 && (
            <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {task.completion_record.evidence.map((e, i) => (
                <p key={i}>
                  <span className="font-bold uppercase tracking-wider text-secondary/80">{e.label}</span>: {e.value}
                </p>
              ))}
            </div>
          )}
          {task.completion_record.note && <p className="mt-0.5 text-muted-foreground">{task.completion_record.note}</p>}
        </div>
      )}

      {detailsOpen && task.waiver && (
        <div className="rounded-md bg-primary/10 px-2 py-1.5 text-[11px] leading-snug">
          <p className="flex items-center gap-1 font-semibold text-primary">
            <Scale className="h-3 w-3" /> Waived by {task.waiver.by_name}
          </p>
          <p className="text-muted-foreground">{task.waiver.reason}</p>
          {task.waiver.policy_basis && <p className="text-muted-foreground">Policy basis: {task.waiver.policy_basis.doc_code}</p>}
        </div>
      )}

      {detailsOpen && task.adaptation && (
        <div className="rounded-md bg-accent/20 px-2 py-1.5 text-[11px] leading-snug">
          <p className="flex items-center gap-1 font-semibold text-foreground">
            <ArrowRightLeft className="h-3 w-3 text-primary" />
            {task.adaptation.kind === "replaced" ? `Adapted → ${task.adaptation.replaced_by}` : "Verification failed — gap re-opened"}
          </p>
          <p className="text-muted-foreground">{task.adaptation.reason}</p>
        </div>
      )}

      {detailsOpen && <WhyEvidence task={task} />}

      {/* Actions */}
      {canComplete && task.state !== "done" && task.state !== "waived" && task.state !== "failed" && task.state !== "blocked" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setCompleteOpen(true)} disabled={busy}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Complete
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBlockerOpen((v) => !v)} disabled={busy}>
            <AlertTriangle className="h-3.5 w-3.5" /> Report blocker
          </Button>
          {canWaive && (
            <Button size="sm" variant="ghost" onClick={() => setWaiveOpen(true)} disabled={busy}>
              <Scale className="h-3.5 w-3.5" /> Waive
            </Button>
          )}
          {canAdapt && task.task_type === "learning" && (
            <Button size="sm" variant="ghost" onClick={() => setAdaptOpen(true)} disabled={busy}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> Adapt to verification
            </Button>
          )}
          {canFail && task.task_type === "verification" && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setFailOpen(true)} disabled={busy}>
              <XCircle className="h-3.5 w-3.5" /> Mark failed
            </Button>
          )}
        </div>
      )}

      {task.state === "blocked" && (task.blocked_reasons ?? []).length === 0 && openBlockers.length === 0 && (
        <p className="rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">Blocked by a prerequisite upstream.</p>
      )}

      {blockerOpen && (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={2}
            value={blockerText}
            onChange={(e) => setBlockerText(e.target.value)}
            placeholder="Describe the blocker…"
            className="h-auto min-h-0 text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { if (blockerText.trim()) onBlock(blockerText.trim()); setBlockerText(""); setBlockerOpen(false); }} disabled={busy || !blockerText.trim()}>
              Report
            </Button>
          </div>
        </div>
      )}

      {/* Completion evidence dialog */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete: {task.title}</DialogTitle>
            <DialogDescription>Genuine completion requires evidence per task requirements.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {(task.evidence_requirements ?? []).map((r) => {
              const hasError = evErrors.has(r.label);
              return (
                <label key={r.label} className="flex flex-col gap-1 text-xs font-semibold text-foreground">
                  <span className={hasError ? "text-destructive" : ""}>
                    {r.label} {r.required ? "" : "(optional)"}
                  </span>
                  <Input
                    value={evidence[r.label] ?? ""}
                    onChange={(e) => setEvidenceValue(r.label, e.target.value)}
                    placeholder={r.kind === "note" ? "Evidence reference…" : "Assessment evidence id…"}
                    className={`text-sm font-normal ${hasError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    aria-invalid={hasError}
                  />
                  {hasError && <span className="text-[11px] font-normal text-destructive">Required before completion — add a value to continue.</span>}
                </label>
              );
            })}
            <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
              Note (optional)
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="h-auto min-h-0 text-xs font-normal" />
            </label>
          </div>
          <DialogFooter>
            <Button onClick={doComplete} disabled={busy || !evidenceComplete} title={!evidenceComplete ? "Complete all required evidence fields first" : undefined}>
              <CheckCircle2 className="h-4 w-4" /> Confirm completion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waiver dialog */}
      <Dialog open={waiveOpen} onOpenChange={setWaiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Waive: {task.title}</DialogTitle>
            <DialogDescription>
              {task.non_waivable
                ? "This is a mandatory security requirement — an HR Executive waiver with a policy basis and reason is required."
                : "A reason is required. A policy basis citation is recommended."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
              Reason
              <Textarea rows={2} value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} className="h-auto min-h-0 text-xs font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
              Policy basis (doc_code, optional unless mandatory)
              <Input value={waivePolicy} onChange={(e) => setWaivePolicy(e.target.value)} placeholder="e.g. POL-SEC" className="text-sm font-normal" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={() => { if (waiveReason.trim()) onWaive(waiveReason.trim(), waivePolicy.trim()); setWaiveOpen(false); setWaiveReason(""); setWaivePolicy(""); }} disabled={busy || !waiveReason.trim()}>
              Confirm waiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adapt dialog */}
      <Dialog open={adaptOpen} onOpenChange={setAdaptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adapt learning → verification</DialogTitle>
            <DialogDescription>New assessment evidence replaces further learning for this skill with a verification task. The plan version bumps and approvals are invalidated.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
            Reason / evidence note
            <Textarea rows={2} value={adaptNote} onChange={(e) => setAdaptNote(e.target.value)} placeholder="e.g. Assessment evidence confirms mastery at target…" className="h-auto min-h-0 text-xs font-normal" />
          </label>
          <DialogFooter>
            <Button onClick={() => { onAdapt(adaptNote.trim()); setAdaptOpen(false); setAdaptNote(""); }} disabled={busy}>
              Confirm adaptation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fail dialog */}
      <Dialog open={failOpen} onOpenChange={setFailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark verification failed</DialogTitle>
            <DialogDescription>The gap re-opens and the plan is revised — approvals are invalidated and a re-learning task is added.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
            Reason
            <Textarea rows={2} value={failNote} onChange={(e) => setFailNote(e.target.value)} placeholder="e.g. Assessment anchor not met…" className="h-auto min-h-0 text-xs font-normal" />
          </label>
          <DialogFooter>
            <Button variant="destructive" onClick={() => { onFail(failNote.trim()); setFailOpen(false); setFailNote(""); }} disabled={busy}>
              Confirm failure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeQueue({ journey, onOpen }: { journey: QueueJourney; onOpen: (code: string) => void }) {
  const waiting = journey.waiting_on ?? [];
  return (
    <div className="rounded-lg bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Waiting on others</p>
        {journey.overdue && (
          <span className="flex items-center gap-1 rounded-md bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
            <Hourglass className="h-3 w-3" /> {journey.overdue_count} overdue
          </span>
        )}
        {journey.stalled && (
          <span className="flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
            <AlertOctagon className="h-3 w-3" /> Stalled · {journey.stall_reasons.join(", ")}
          </span>
        )}
      </div>
      {waiting.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing is blocking you — tasks owned by others are all complete. Your next action is below.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {waiting.map((t) => (
            <div key={t.task_code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{t.title}</p>
                <p className="text-[11px] text-muted-foreground">owned by {OWNER_LABEL[t.owner_role as PlanTaskView["owner_role"]] ?? t.owner_role} · due {fmt(t.due_date)}</p>
              </div>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${(TASK_STATE_META[t.state as PlanTaskView["state"]] ?? TASK_STATE_META.pending).cls}`}>
                {TASK_STATE_META[t.state as PlanTaskView["state"]]?.label ?? t.state}
              </span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => onOpen(t.task_code)}>
                Open task <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JourneysQueue({
  journeys,
  filters,
  filter,
  setFilter,
  onSelect,
  onSummary,
  people,
  compared,
  toggleCompare,
}: {
  journeys: QueueJourney[];
  filters: { all: number; pending_approval: number; overdue: number; stalled: number };
  filter: "all" | "pending_approval" | "overdue" | "stalled";
  setFilter: (f: "all" | "pending_approval" | "overdue" | "stalled") => void;
  onSelect: (twinId: string) => void;
  onSummary: (twinId: string) => void;
  people: Map<string, string>;
  compared: Set<string>;
  toggleCompare: (twinId: string) => void;
}) {
  // Batch D (D1): search + department + plan-status filters on the overview.
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending_approval" | "approved" | "completed">("all");

  const departments = [...new Set(journeys.map((j) => j.department).filter(Boolean) as string[])].sort();
  const q = search.trim().toLowerCase();
  const visible = journeys.filter((j) => {
    if (filter === "stalled" && !j.stalled) return false;
    if (filter === "overdue" && !j.overdue) return false;
    if (filter === "pending_approval" && !(j.pending_manager_approval || j.pending_hr_approval)) return false;
    if (statusFilter !== "all" && j.status !== statusFilter) return false;
    if (departmentFilter !== "all" && j.department !== departmentFilter) return false;
    if (
      q &&
      ![j.employee_name, j.job_title ?? "", j.department ?? "", people.get(j.manager_id ?? "") ?? ""].some((s) =>
        s.toLowerCase().includes(q)
      )
    ) {
      return false;
    }
    return true;
  });
  const chips: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: filters.all },
    { key: "pending_approval", label: "Pending approval", count: filters.pending_approval },
    { key: "overdue", label: "Overdue", count: filters.overdue },
    { key: "stalled", label: "Stalled", count: filters.stalled },
  ];

  return (
    <div className="rounded-lg bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">All onboarding journeys</p>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider transition-colors ${
                filter === c.key ? "bg-foreground text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label} ({c.count})
            </button>
          ))}
        </div>
      </div>

      {/* Search + department + plan-status filters (Batch D, D1) */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, role, department or manager…"
            aria-label="Search journeys"
            className="h-9 w-full rounded-md border border-border bg-white pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          aria-label="Filter by department"
          className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          aria-label="Filter by plan status"
          className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
        >
          <option value="all">All plan statuses</option>
          <option value="pending_approval">Pending approval</option>
          <option value="approved">Active (approved)</option>
          <option value="completed">Completed</option>
        </select>
        <span className="ml-auto text-xs font-bold uppercase tracking-wider text-muted-foreground">{visible.length} shown</span>
      </div>

      {visible.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No journeys match the current filters.</p>}
      <div className="mt-3 flex flex-col gap-2">
        {visible.map((j) => {
          const managerName = people.get(j.manager_id ?? "") ?? "—";
          return (
            <div key={j.twin_id} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3 transition-all duration-200 hover:bg-border">
              <button
                type="button"
                onClick={() => onSummary(j.twin_id)}
                className="min-w-0 flex-1 text-left"
                title="Open journey summary"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <p className="truncate text-sm font-bold text-foreground">{j.employee_name}</p>
                  <span className="text-[11px] text-muted-foreground">
                    {j.job_title ?? "Employee"}
                    {j.department ? ` · ${j.department}` : ""} · mgr {managerName}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  started {fmt(j.start_date)} · {j.completed_tasks}/{j.total_tasks} tasks · plan v{j.version} · {j.readiness_pct}% complete
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {j.status === "pending_approval" && <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">Pending approval</span>}
                  {j.status === "approved" && <span className="rounded bg-secondary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary">Active</span>}
                  {j.status === "completed" && <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Completed</span>}
                  {(j.pending_manager_approval || j.pending_hr_approval) && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                      {j.pending_manager_approval ? "Manager" : ""}
                      {j.pending_manager_approval && j.pending_hr_approval ? " + " : ""}
                      {j.pending_hr_approval ? "HR" : ""} sign-off needed
                    </span>
                  )}
                  {j.blocked_count > 0 && (
                    <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">{j.blocked_count} blocked</span>
                  )}
                  {j.overdue && (
                    <span className="flex items-center gap-1 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                      <Hourglass className="h-3 w-3" /> {j.overdue_count} overdue
                    </span>
                  )}
                  {j.stalled && (
                    <span className="flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                      <AlertOctagon className="h-3 w-3" /> Stalled
                    </span>
                  )}
                  {j.viewer_actions.length > 0 && (
                    <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
                      {j.viewer_actions.length} action{j.viewer_actions.length > 1 ? "s" : ""} for you
                    </span>
                  )}
                </div>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Button size="sm" variant="outline" className="h-7" onClick={() => onSelect(j.twin_id)}>
                  Open plan <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={compared.has(j.twin_id)}
                    onChange={() => toggleCompare(j.twin_id)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Compare
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProvisioningQueue({
  items,
  names,
  people,
  onOpen,
}: {
  items: QueueTaskRef[];
  names: Map<string, string>;
  people: Map<string, { start_date: string | null; manager_name: string | null }>;
  onOpen: (twinId: string, code: string) => void;
}) {
  const [filter, setFilter] = useState<ItQueueFilter>("all");
  const [search, setSearch] = useState("");
  const now = useMemo(() => new Date().toISOString(), []);
  const visible = useMemo(() => filterItProvisioning(items, names, filter, search, now), [items, names, filter, search, now]);
  const FILTERS: { key: ItQueueFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "ready", label: "Ready" },
    { key: "blocked", label: "Blocked" },
    { key: "overdue", label: "Overdue" },
    { key: "done", label: "Completed" },
  ];
  return (
    <div className="rounded-lg bg-white p-5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Provisioning & access queue</p>
        <span className="rounded-md bg-foreground px-2 py-0.5 text-[10px] font-bold text-white">{items.length}</span>
      </div>
      {/* Batch 4 (4.1): operational filters — Ready / Blocked / Overdue /
          Completed — plus employee & task-title search. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter provisioning queue">
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
          aria-label="Search provisioning queue by employee or task"
          className="h-9 w-full min-w-0 flex-1 rounded-md border border-border bg-white px-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-56"
        />
      </div>
      {visible.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {items.length === 0 ? "No provisioning or access tasks are waiting right now." : "No tasks match this filter."}
        </p>
      )}
      <div className="mt-2 flex flex-col gap-2">
        {visible.map((t) => {
          const person = people.get(t.twin_id);
          return (
            <button
              key={`${t.twin_id}-${t.task_code}`}
              type="button"
              onClick={() => onOpen(t.twin_id, t.task_code)}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-left transition-all duration-200 hover:bg-border"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{t.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  for {names.get(t.twin_id) ?? "employee"}
                  {person?.start_date ? ` · starts ${fmt(person.start_date)}` : ""}
                  {person?.manager_name ? ` · manager ${person.manager_name}` : ""}
                  {t.blockers && t.blockers.length > 0 ? ` · ${t.blockers.length} blocker(s)` : ""}
                  {t.depends_on && t.depends_on.length > 0 ? ` · waits on ${t.depends_on.join(", ")}` : ""}
                  {t.evidence_requirements && t.evidence_requirements.length > 0 ? ` · evidence required` : ""}
                  {` · due ${fmt(t.due_date)}`}
                </p>
              </div>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${(TASK_STATE_META[t.state as keyof typeof TASK_STATE_META] ?? TASK_STATE_META.pending).cls}`}>
                {TASK_STATE_META[t.state as keyof typeof TASK_STATE_META]?.label ?? t.state}
              </span>
              <Button size="sm" variant="outline" className="h-7">
                Open task <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JourneySummaryDialog({
  journey,
  people,
  onClose,
  onOpenPlan,
}: {
  journey: QueueJourney;
  people: Map<string, string>;
  onClose: () => void;
  onOpenPlan: (twinId: string) => void;
}) {
  const managerName = people.get(journey.manager_id ?? "") ?? "—";
  const gates = journey.gates ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> {journey.employee_name} — onboarding
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {/* Who this is about */}
          <section className="rounded-lg bg-muted p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Who</p>
            <p className="mt-1 text-sm text-foreground">
              <b>{journey.employee_name}</b> · {journey.job_title ?? "Employee"}
              {journey.department ? ` · ${journey.department}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Manager: {managerName} · Started {fmt(journey.start_date)} · Plan v{journey.version}
            </p>
          </section>

          {/* Plan state — plan approval is NOT readiness */}
          <section className="rounded-lg bg-muted p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Plan status & approvals</p>
            <p className="mt-1 text-sm text-foreground">
              <b>
                {journey.status === "approved"
                  ? "Active"
                  : journey.status === "pending_approval"
                    ? "Pending approval"
                    : journey.status === "completed"
                      ? "Completed"
                      : journey.status}
              </b>
              {journey.pending_manager_approval || journey.pending_hr_approval ? (
                <span className="ml-2 text-xs text-accent">
                  awaiting {[journey.pending_manager_approval ? "Manager" : "", journey.pending_hr_approval ? "HR" : ""].filter(Boolean).join(" + ")} sign-off
                </span>
              ) : (
                <span className="ml-2 text-xs text-muted-foreground">manager + HR sign-off recorded</span>
              )}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Plan approval is a gate on the plan itself — separate from task completion and from role readiness.
            </p>
          </section>

          {/* Progress: owned-task completion vs gates vs readiness */}
          <section className="rounded-lg bg-muted p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Progress</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground">Owned tasks completed</p>
                <p className="text-lg font-extrabold text-foreground">
                  {journey.completed_tasks}/{journey.total_tasks}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Readiness (estimate)</p>
                <p className="text-lg font-extrabold text-foreground">
                  {journey.readiness_pct}%
                  {journey.provisional && <span className="ml-1 align-middle text-[10px] font-bold uppercase text-accent">provisional</span>}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Projected ready</p>
                <p className="text-lg font-extrabold text-foreground">{journey.projected_ready_date ? fmt(journey.projected_ready_date) : "unknown"}</p>
              </div>
            </div>
            {gates.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                {gates.map((g) => (
                  <div key={g.key} className="flex items-center gap-2 text-xs">
                    <span className="w-32 shrink-0 font-semibold text-foreground">{g.label}</span>
                    <div className="h-2 w-full max-w-[160px] overflow-hidden rounded-full bg-white">
                      <div className={`h-full ${g.key === "capability" ? "bg-secondary" : g.key === "compliance" ? "bg-accent" : "bg-primary"}`} style={{ width: `${g.pct}%` }} />
                    </div>
                    <span className="text-muted-foreground">{g.pct}%</span>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">
                  Mandatory readiness gates. A waived task never counts as capability.
                </p>
              </div>
            )}
          </section>

          {/* Blockers / waiting on */}
          <section className="rounded-lg bg-muted p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Blockers & waiting</p>
            {journey.blocked_count > 0 || journey.stalled ? (
              <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
                {journey.stall_reasons.map((r) => (
                  <li key={r} className="flex items-center gap-1.5">
                    <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-destructive" /> {r}
                  </li>
                ))}
                {journey.blocked_count > 0 && (
                  <li className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" /> {journey.blocked_count} blocked task(s)
                  </li>
                )}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">No open blockers.</p>
            )}
            {journey.waiting_on.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold text-muted-foreground">Waiting on others (gates the employee's next steps)</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {journey.waiting_on.slice(0, 4).map((t) => (
                    <li key={t.task_code} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-xs">
                      <span className="truncate font-medium text-foreground">{t.title}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {OWNER_LABEL[t.owner_role as PlanTaskView["owner_role"]] ?? t.owner_role} · due {fmt(t.due_date)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* What the viewer can do now */}
          {journey.viewer_actions.length > 0 && (
            <section className="rounded-lg bg-primary/5 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-primary">Actions available to you</p>
              <ul className="mt-1 flex flex-col gap-1">
                {journey.viewer_actions.map((t) => (
                  <li key={t.task_code} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-foreground">{t.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {OWNER_LABEL[t.owner_role as PlanTaskView["owner_role"]] ?? t.owner_role} · due {fmt(t.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">Opening the full plan lets you act on these tasks.</p>
            </section>
          )}

          <Button onClick={() => onOpenPlan(journey.twin_id)}>
            Open full plan <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompareDialog({
  journeys,
  people,
  onClose,
  onOpenPlan,
}: {
  journeys: QueueJourney[];
  people: Map<string, string>;
  onClose: () => void;
  onOpenPlan: (twinId: string) => void;
}) {
  const daysSinceStart = (startDate: string) => Math.max(0, Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" /> Compare journeys ({journeys.length})
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-snug text-muted-foreground">
          These journeys may target different roles. Different role plans are <b>not directly equivalent</b> — compare
          the process signals (approval, completion, gates, blockers), never a person against a person.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="rounded-tl-lg bg-muted p-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Metric</th>
                {journeys.map((j) => (
                  <th key={j.twin_id} className="bg-muted p-2 text-left text-xs font-bold text-foreground">
                    {j.employee_name}
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {j.job_title ?? "Employee"}
                      {j.department ? ` · ${j.department}` : ""}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="p-2 text-xs font-semibold text-muted-foreground">Manager</td>
                {journeys.map((j) => (
                  <td key={j.twin_id} className="p-2 text-xs text-foreground">{people.get(j.manager_id ?? "") ?? "—"}</td>
                ))}
              </tr>
              <tr>
                <td className="p-2 text-xs font-semibold text-muted-foreground">Plan status</td>
                {journeys.map((j) => (
                  <td key={j.twin_id} className="p-2 text-xs text-foreground">
                    {j.status === "approved" ? "Active" : j.status === "pending_approval" ? "Pending approval" : j.status === "completed" ? "Completed" : j.status}
                    {j.pending_manager_approval || j.pending_hr_approval ? " · sign-off needed" : ""}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-2 text-xs font-semibold text-muted-foreground">Owned tasks completed</td>
                {journeys.map((j) => (
                  <td key={j.twin_id} className="p-2 text-xs text-foreground">
                    {j.completed_tasks}/{j.total_tasks}
                  </td>
                ))}
              </tr>
              {(["access", "compliance", "capability"] as const).map((key) => (
                <tr key={key}>
                  <td className="p-2 text-xs font-semibold text-muted-foreground">Gate: {key}</td>
                  {journeys.map((j) => {
                    const gate = (j.gates ?? []).find((g) => g.key === key);
                    return <td key={j.twin_id} className="p-2 text-xs text-foreground">{gate ? `${gate.pct}%` : "—"}</td>;
                  })}
                </tr>
              ))}
              <tr>
                <td className="p-2 text-xs font-semibold text-muted-foreground">Blocked tasks</td>
                {journeys.map((j) => (
                  <td key={j.twin_id} className="p-2 text-xs text-foreground">{j.blocked_count}</td>
                ))}
              </tr>
              <tr>
                <td className="p-2 text-xs font-semibold text-muted-foreground">Overdue tasks</td>
                {journeys.map((j) => (
                  <td key={j.twin_id} className="p-2 text-xs text-foreground">{j.overdue_count}</td>
                ))}
              </tr>
              <tr>
                <td className="p-2 text-xs font-semibold text-muted-foreground">Time since start</td>
                {journeys.map((j) => (
                  <td key={j.twin_id} className="p-2 text-xs text-foreground">{daysSinceStart(j.start_date)}d</td>
                ))}
              </tr>
              <tr>
                <td className="p-2 text-xs font-semibold text-muted-foreground">Readiness (estimate)</td>
                {journeys.map((j) => (
                  <td key={j.twin_id} className="p-2 text-xs text-foreground">
                    {j.readiness_pct}%{j.provisional ? " (provisional)" : ""}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-2 text-xs font-semibold text-muted-foreground">Projected ready</td>
                {journeys.map((j) => (
                  <td key={j.twin_id} className="p-2 text-xs text-foreground">{j.projected_ready_date ? fmt(j.projected_ready_date) : "unknown"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {journeys.map((j) => (
            <Button key={j.twin_id} size="sm" variant="outline" onClick={() => onOpenPlan(j.twin_id)}>
              {j.employee_name} <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Onboarding() {  const { role, twin, user } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const urlTwin = searchParams.get("twin");
  const [selected, setSelected] = useState<string>(urlTwin ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [govOpen, setGovOpen] = useState(false);
  const dagRef = useRef<HTMLDivElement>(null);
  // Tracks whether the user explicitly picked an employee from the dropdown —
  // the demo fallback never overrides an explicit choice.
  const userPickedRef = useRef(false);

  const canView = role ? can(role, "view_onboarding") : false;

  const employees = useQuery({
    queryKey: ["ob-employees", user?.id ?? "anon"],
    enabled: canView && role !== "employee",
    queryFn: async () => {
      const { data } = await supabase.from("digital_twins").select("id, name, role, job_title").in("role", ["employee"]).order("name");
      return (data ?? []) as { id: string; name: string; role: string; job_title: string | null }[];
    },
  });

  // Which employees currently have onboarding plans (used by the demo fallback
  // so the dependency graph is always shown on page load for managers/HR).
  const planOwners = useQuery({
    queryKey: ["ob-plan-owners", user?.id ?? "anon"],
    enabled: canView,
    queryFn: async () => {
      const { data } = await supabase.from("onboarding_plans").select("twin_id").order("version", { ascending: false });
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of (data ?? []) as { twin_id: string }[]) {
        if (!seen.has(r.twin_id)) {
          seen.add(r.twin_id);
          out.push(r.twin_id);
        }
      }
      return out;
    },
  });

  const plan = useQuery({
    queryKey: ["plan", user?.id ?? "anon", selected],
    enabled: !!selected && canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_plans")
        .select("*")
        .eq("twin_id", selected)
        .eq("org_id", twin?.org_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? decode(planViewSchema, data, "plan-row") : null;
    },
  });

  // Employee + IT service view resolve to the actor's own twin by default.
  // Managers/HR land on a default demo employee WITH an active plan so the DAG
  // is visible on page load; if a selection has no plan yet and the user has
  // not explicitly picked someone, fall back to that default.
  useEffect(() => {
    if (!canView) return;
    // Deep link: ?twin=<id> selects a specific employee and counts as a pick.
    if (urlTwin) {
      if (selected !== urlTwin) setSelected(urlTwin);
      userPickedRef.current = true;
      return;
    }
    if (role === "employee") {
      if (twin && !selected) setSelected(twin.id);
      return;
    }
    if (role === "it_security") {
      // Service view: land on an employee WITH an active plan (provisioning
      // work), never on the IT twin's own (nonexistent) journey.
      const fallback = planOwners.data?.find((id) => (employees.data ?? []).some((e) => e.id === id)) ?? null;
      if (fallback && !selected) setSelected(fallback);
      return;
    }
    if (!["manager", "hr_executive", "hr_partner"].includes(role ?? "")) return;
    const fallback =
      planOwners.data?.find((id) => (employees.data ?? []).some((e) => e.id === id)) ??
      (employees.data ?? [])[0]?.id;
    if (!fallback) return;
    if (!selected) {
      setSelected(fallback);
      return;
    }
    if (
      !userPickedRef.current &&
      plan.data === null &&
      planOwners.data &&
      planOwners.data.length > 0 &&
      !planOwners.data.includes(selected)
    ) {
      setSelected(fallback);
    }
  }, [role, twin, selected, canView, user, urlTwin, employees.data, planOwners.data, plan.data]);

  const tasks = useQuery({
    queryKey: ["plan-tasks", user?.id ?? "anon", plan.data?.id ?? "none"],
    enabled: !!plan.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_tasks")
        .select("*")
        .eq("plan_id", plan.data!.id)
        .order("topological_level", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((t) => {
        // onboarding_tasks has no blocked_reasons column; derive it for the
        // contract so the plan/task view stays a single source of truth.
        const row = { ...t, blocked_reasons: (t as { blocked_reasons?: unknown }).blocked_reasons ?? [] };
        return decode(planTaskViewSchema, row, "plan-task-row");
      });
    },
  });

  // Name resolution for managers + journey summaries (Batch D, D1) — RLS
  // scopes the rows to what this role may read (org for HR, team for managers).
  const people = useQuery({
    queryKey: ["ob-people", user?.id ?? "anon"],
    enabled: canView,
    queryFn: async () => {
      const { data } = await supabase.from("digital_twins").select("id, name, role");
      return (data ?? []) as { id: string; name: string; role: string }[];
    },
  });
  const peopleById = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.name])), [people.data]);

  // Phase 6: role-scoped operational queue (all journeys for HR/manager/IT,
  // own journey for employees) with stalled/overdue signals.
  const queue = useQuery({
    queryKey: ["ob-queue", user?.id ?? "anon"],
    enabled: canView,
    queryFn: onboardingQueue,
  });
  const [view, setView] = useState<"timeline" | "dag">("timeline");
  const [queueFilter, setQueueFilter] = useState<"all" | "pending_approval" | "overdue" | "stalled">("all");
  const [activeCode, setActiveCode] = useState<string | null>(null);
  // Batch D (D1/D3): journey summary dialog + compare selection (max 3).
  const [summaryTwin, setSummaryTwin] = useState<string | null>(null);
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  const toggleCompare = (twinId: string) => {
    setCompareSet((prev) => {
      const next = new Set(prev);
      if (next.has(twinId)) next.delete(twinId);
      else if (next.size < 3) next.add(twinId);
      else {
        toast.info("Compare up to 3 journeys at a time.");
        return prev;
      }
      return next;
    });
  };
  const openJourneyPlan = (twinId: string) => {
    setSummaryTwin(null);
    userPickedRef.current = true;
    setSelected(twinId);
  };

  // Scroll to a specific task after its plan/tasks finish loading (queue deep link).
  useEffect(() => {
    if (!activeCode) return;
    const id = `task-${activeCode}`;
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveCode(null);
    }, 250);
    return () => clearTimeout(t);
  }, [activeCode, plan.data?.id, tasks.data]);

  const build = async (regen = false) => {
    if (!selected) return;
    setBusy("gen");
    try {
      await onboardingPlanBuild(selected, regen);
      toast.success(regen ? "Plan regenerated — approvals invalidated (new version)." : "Plan built from the approved role relationship.");
      await qc.invalidateQueries({ queryKey: ["plan", user?.id ?? "anon", selected] });
      await qc.invalidateQueries({ queryKey: ["plan-tasks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!plan.data) return;
    setBusy("approve");
    try {
      const res = await onboardingPlanApprove(plan.data.id, plan.data.plan_hash);
      toast.success(res.status === "approved" ? "Plan active — both approvals received." : "Approval recorded.");
      await qc.invalidateQueries({ queryKey: ["plan", user?.id ?? "anon", selected] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  };

  const act = async (taskCode: string, action: "complete" | "block" | "resolve" | "waive" | "adapt" | "fail", payload: Record<string, unknown> = {}) => {
    if (!plan.data) return;
    setBusy(`${action}-${taskCode}`);
    try {
      await onboardingTaskAction(plan.data.id, taskCode, action, payload);
      const verb: Record<string, string> = {
        complete: "Task completed with evidence.",
        block: "Blocker reported.",
        resolve: "Blocker resolved.",
        waive: "Task waived.",
        adapt: "Plan adapted to a verification task — pending approval again.",
        fail: "Verification failed — plan revised, gap re-opened.",
      };
      toast.success(verb[action] ?? "Updated.");
      await qc.invalidateQueries({ queryKey: ["plan", user?.id ?? "anon", selected] });
      await qc.invalidateQueries({ queryKey: ["plan-tasks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const viewer = twin ? { id: twin.id, role: twin.role } : null;

  const renderTaskCard = (task: PlanTaskView) => {
    const ownerMatch =
      task.owner_role === "employee"
        ? isOwner
        : task.owner_role === "manager"
          ? role === "manager" && twin?.id === planData?.twin_id
          : task.owner_role === "hr"
            ? role === "hr_executive" || role === "hr_partner"
            : role === "it_security";
    const canComplete = planActive && ownerMatch && task.state === "ready";
    const canWaiveAct = (role === "manager" && twin?.id === planData?.twin_id) || role === "hr_executive" || role === "hr_partner";
    const canAdaptAct = canWaiveAct;
    const canFail = canAdaptAct;
    // Blocker resolution mirrors the server matrix: HR and the employee's
    // manager may resolve any blocker; the owner resolves on their own task.
    const canResolve =
      role === "hr_executive" ||
      role === "hr_partner" ||
      (role === "manager" && twin?.id === planData?.twin_id) ||
      (role === "employee" && isOwner && task.owner_role === "employee") ||
      (role === "it_security" && task.owner_role === "it_security");
    return (
      <div key={task.task_code} id={`task-${task.task_code}`} className="scroll-mt-24">
        <TaskCard
          task={task}
          plan={planData!}
          viewer={viewer}
          canComplete={canComplete}
          canWaive={canWaiveAct}
          canAdapt={canAdaptAct}
          canFail={canFail}
          canResolve={canResolve}
          titleFor={(code) => allTasks.find((t) => t.task_code === code)?.title ?? code}
          onComplete={(evidence, note) => void act(task.task_code, "complete", { evidence, note })}
          onBlock={(note) => void act(task.task_code, "block", { note })}
          onResolve={(blockerId) => void act(task.task_code, "resolve", { blocker_id: blockerId })}
          onWaive={(reason, policyDoc) => void act(task.task_code, "waive", { waiver: { reason, policy_basis: policyDoc ? { doc_code: policyDoc, version: null } : null } })}
          onAdapt={(note) => void act(task.task_code, "adapt", { note, skill: inferSkill(task) })}
          onFail={(note) => void act(task.task_code, "fail", { note, skill: inferSkill(task) })}
          busy={busy === `complete-${task.task_code}` || busy === `block-${task.task_code}` || busy === `resolve-${task.task_code}` || busy === `waive-${task.task_code}` || busy === `adapt-${task.task_code}` || busy === `fail-${task.task_code}`}
        />
      </div>
    );
  };

  const columns = useMemo(() => {
    const list = tasks.data ?? [];
    const maxLevel = list.reduce((m, t) => Math.max(m, t.topological_level ?? 0), -1);
    const cols: PlanTaskView[][] = Array.from({ length: maxLevel + 1 }, () => []);
    for (const t of list) cols[t.topological_level]?.push(t);
    return cols;
  }, [tasks.data]);

  const allTasks = tasks.data ?? [];

  // Phase 28: hero "next action" — first incomplete task (prefer unblocked).
  const nextTask = allTasks.find((t) => t.state !== "done" && t.state !== "waived");
  const nextUnblocked = allTasks.find((t) => t.state !== "done" && t.state !== "waived" && (t.state === "ready" || t.state === "in_progress"));
  const heroTask = nextUnblocked ?? nextTask;
  const heroLevel = heroTask?.topological_level ?? 0;
  // Critical path comes from the engine (remaining DURATIONS over prerequisites,
  // business days) — never the chain with the largest number of nodes.
  const critical = useMemo(() => {
    const list = tasks.data ?? [];
    const byCode = new Map(list.map((t) => [t.task_code, t]));
    const path = plan.data?.readiness?.critical_path ?? [];
    if (path.length > 0) {
      return path.map((code) => ({ code, title: byCode.get(code)?.title ?? code, days: byCode.get(code)?.duration_days ?? 0 }));
    }
    // Fallback for legacy stored readiness: recompute by duration, mirroring the engine.
    const doneSetLocal = new Set(list.filter((t) => t.state === "done" || t.state === "waived").map((t) => t.task_code));
    const adj = new Map<string, string[]>();
    for (const t of list) for (const d of t.depends_on ?? []) adj.set(d, [...(adj.get(d) ?? []), t.task_code]);
    const memo = new Map<string, { tasks: { code: string; title: string; days: number }[]; days: number }>();
    const chain = (id: string): { tasks: { code: string; title: string; days: number }[]; days: number } => {
      const known = memo.get(id);
      if (known) return known;
      const t = byCode.get(id);
      let best: { tasks: { code: string; title: string; days: number }[]; days: number } = { tasks: [], days: 0 };
      for (const c of adj.get(id) ?? []) {
        const ch = chain(c);
        if (ch.days > best.days) best = ch;
      }
      const res = { tasks: [{ code: id, title: t?.title ?? id, days: t?.duration_days ?? 0 }, ...best.tasks], days: (t?.duration_days ?? 0) + best.days };
      memo.set(id, res);
      return res;
    };
    let best: { tasks: { code: string; title: string; days: number }[]; days: number } = { tasks: [], days: 0 };
    for (const t of list) {
      if (doneSetLocal.has(t.task_code)) continue;
      const ch = chain(t.task_code);
      if (ch.days > best.days) best = ch;
    }
    return best.tasks;
  }, [tasks.data, plan.data?.readiness?.critical_path]);

  const isOwner = selected === twin?.id;
  const canApprove =
    role === "manager" || role === "hr_executive";
  // Regenerating a plan restructures it from the approved role relationship —
  // an HR/manager decision, never an IT service action. IT executes and
  // resolves the service-owned tasks instead.
  const canRegen = role === "manager" || role === "hr_executive";

  if (!canView) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Onboarding access only</h1>
          <p className="text-muted-foreground">This center is for employees, their managers/HR, and IT service owners.</p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const planData = plan.data;
  const readiness = planData?.readiness;
  const mgrApproved = Boolean(planData?.manager_approval);
  const hrApproved = Boolean(planData?.hr_approval);
  const planActive = planData?.status === "approved";
  const planPending = planData?.status === "pending_approval";

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Adaptive Onboarding Center</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Owned tasks, <span className="text-primary">versioned approvals</span>, real evidence.
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Plans are built from the approved role relationship, scheduled as a DAG, and every completion
            requires an authorized owner and genuine evidence.
          </p>
        </div>

        {/* Role-scoped operational queue (Phase 6) */}
        {queue.isPending && (
          <div className="mt-8 flex items-center gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your onboarding queue…
          </div>
        )}
        {queue.data && (queue.data.journeys.length > 0 || (role === "it_security" && queue.data.provisioning.length > 0)) && (
          <div className="mt-8 flex flex-col gap-4">
            {role === "employee" && <EmployeeQueue journey={queue.data.journeys[0]} onOpen={(code) => setActiveCode(code)} />}
            {(role === "manager" || role === "hr_executive" || role === "hr_partner") && (
              <>
                {compareSet.size > 0 && (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-foreground p-4 text-white">
                    <p className="flex items-center gap-2 text-sm text-white/80">
                      <ArrowRightLeft className="h-4 w-4 text-secondary" />
                      {compareSet.size} journey(s) selected for comparison.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setCompareOpen(true)}
                        disabled={compareSet.size < 2}
                      >
                        Compare ({compareSet.size})
                      </Button>
                      <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setCompareSet(new Set())}>
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
                <JourneysQueue
                  journeys={queue.data.journeys}
                  filters={queue.data.filters}
                  filter={queueFilter}
                  setFilter={setQueueFilter}
                  people={peopleById}
                  compared={compareSet}
                  toggleCompare={toggleCompare}
                  onSummary={setSummaryTwin}
                  onSelect={(twinId) => {
                    userPickedRef.current = true;
                    setSelected(twinId);
                  }}
                />
              </>
            )}
            {role === "it_security" && (
              <ProvisioningQueue
                items={queue.data.provisioning}
                names={new Map((queue.data.people ?? []).map((p) => [p.twin_id, p.name]))}
                people={new Map((queue.data.people ?? []).map((p) => [p.twin_id, { start_date: p.start_date, manager_name: p.manager_name }]))}
                onOpen={(twinId, code) => {
                  setSelected(twinId);
                  setActiveCode(code);
                }}
              />
            )}
          </div>
        )}

        {role !== "employee" && (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Users className="h-5 w-5 text-primary" strokeWidth={2.5} />
            <select
              value={selected}
              onChange={(e) => {
                userPickedRef.current = true;
                setSelected(e.target.value);
              }}
              className="h-12 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
            >
              <option value="">Select an employee…</option>
              {(employees.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.job_title ?? "Employee"}
                </option>
              ))}
            </select>
            {selected && !planData && role !== "it_security" && (
              <Button onClick={() => void build(false)} disabled={busy === "gen"}>
                {busy === "gen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Build plan from approved role
              </Button>
            )}
          </div>
        )}

        {role === "employee" && !planData && (
          <div className="mt-8 flex items-center gap-3 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading your plan…
          </div>
        )}

        {selected && planData && (
          <div className="mt-8 flex flex-col gap-6">
            {/* Plan header: status / approvals / version+hash / regenerate */}
            <div className="rounded-lg bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Plan status</p>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                        planData.status === "approved"
                          ? "bg-secondary text-white"
                          : planData.status === "pending_approval"
                            ? "bg-accent text-foreground"
                            : "bg-muted text-foreground"
                      }`}
                    >
                      {planData.status === "approved" ? "Active" : planData.status === "pending_approval" ? "Pending approval" : planData.status}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      v<b className="text-foreground">{planData.version}</b>
                      <span className="ml-2">
                        <details className="inline">
                          <summary className="inline cursor-pointer font-semibold text-primary">version details</summary>
                          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{planData.plan_hash}</code>
                        </details>
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className={`flex min-w-0 items-center gap-1.5 ${mgrApproved ? "text-secondary" : "text-muted-foreground"}`}>
                      <UserCheck className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        Manager {mgrApproved ? "approved by " : "pending"}
                        {mgrApproved && <b className="break-all">{planData.manager_approval?.by}</b>}
                      </span>
                    </span>
                    <span className={`flex min-w-0 items-center gap-1.5 ${hrApproved ? "text-secondary" : "text-muted-foreground"}`}>
                      <BadgeCheck className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        HR Exec {hrApproved ? "approved by " : "pending"}
                        {hrApproved && <b className="break-all">{planData.hr_approval?.by}</b>}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    {canApprove && planPending && role === "manager" && !isOwner && (
                      <Button size="sm" onClick={() => void approve()} disabled={busy === "approve"}>
                        {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                        Approve as Manager
                      </Button>
                    )}
                    {canApprove && planPending && role === "hr_executive" && (
                      <Button size="sm" onClick={() => void approve()} disabled={busy === "approve"}>
                        {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                        Approve as HR Exec
                      </Button>
                    )}
                    {isOwner && role === "employee" && (
                      <p className="text-[11px] text-muted-foreground">An employee cannot approve their own plan.</p>
                    )}
                    {canRegen && (
                      <Button size="sm" variant="outline" onClick={() => void build(true)} disabled={busy === "gen"}>
                        {busy === "gen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Generate new plan version
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Generates a new plan version — the active plan is never modified in place.
                </p>
              </div>

              {readiness && (
                <div className="mt-4 rounded-lg bg-muted p-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Task completion</p>
                    <p className="text-3xl font-extrabold leading-none text-foreground">{readiness.ready_pct}%</p>
                  </div>
                  <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-white">
                    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${readiness.ready_pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {readiness.satisfied} of {readiness.total} tasks completed
                    {readiness.blocked_count > 0 ? ` · ${readiness.blocked_count} blocked` : ""}
                    {readiness.remaining_critical_days != null ? ` · ${readiness.remaining_critical_days}d remaining on critical path (business days)` : ""}
                  </p>
                  {/* Readiness dimensions shown separately from completion */}
                  {(readiness.dimensions ?? []).length > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {readiness.dimensions.map((d) => (
                        <div key={d.key} className="rounded-lg bg-white p-3" title={d.note}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{d.label}</p>
                            <p className="text-sm font-extrabold text-foreground">{d.pct}%</p>
                          </div>
                          <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full transition-all duration-500 ${
                                d.key === "capability" ? "bg-secondary" : d.key === "compliance" ? "bg-accent" : "bg-primary"
                              }`}
                              style={{ width: `${d.pct}%` }}
                            />
                          </div>
                          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                            {d.satisfied}/{d.total} · {d.key === "capability" ? "waived never counts as verified" : "done or waived"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {readiness.provisional && (
                      <span className="flex items-center gap-1 rounded-md bg-accent/20 px-2 py-0.5 font-bold uppercase tracking-wider text-accent">
                        <AlertOctagon className="h-3 w-3" /> Provisional estimate
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      Ready {readiness.projected_ready_date ? (
                        <b className="text-foreground">
                          ~{new Date(readiness.projected_ready_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </b>
                      ) : (
                        <b className="text-accent">unknown — blockers open</b>
                      )}
                      {readiness.provisional && " · will update once blockers clear"}
                    </span>
                  </div>
                  {readiness.note && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{readiness.note}</p>}
                </div>
              )}

              {(planData.carryover ?? []).length > 0 && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Preserved from v{(planData.carryover ?? [])[0].from_version}:{" "}
                  {(planData.carryover ?? []).map((c) => allTasks.find((t) => t.task_code === c.task_code)?.title ?? c.task_code).join(", ")}
                </p>
              )}
            </div>

            {/* Phase 28: hero next-action callout */}
            {heroTask && (
              <div className="flex flex-col gap-3 rounded-lg border-2 border-primary/20 bg-primary/5 p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} /> Next action
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-extrabold text-foreground">{heroTask.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {heroTask.state === "blocked"
                        ? `Blocked by a prerequisite — resolve it to continue (Step ${stepFor(heroLevel).n}: ${stepFor(heroLevel).label}).`
                        : `Step ${stepFor(heroLevel).n}: ${stepFor(heroLevel).label} · due ${heroTask.due_date ? fmt(heroTask.due_date) : "—"}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => document.getElementById("onboarding-dag")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    {heroTask.state === "blocked" ? <AlertTriangle className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                    {heroTask.state === "blocked" ? "View blocked step" : "View step"}
                  </Button>
                </div>
              </div>
            )}

            {/* Phase 28: sticky milestone stepper */}
            {columns.length > 0 && (
              <div className="flex w-full items-start justify-between gap-1 overflow-x-auto rounded-lg bg-white p-4">
                {columns.map((col, level) => {
                  const active = level === heroLevel;
                  const complete = col.every((t) => t.state === "done" || t.state === "waived");
                  return (
                    <div key={level} className="flex min-w-[96px] flex-1 flex-col items-center gap-1.5">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                          complete ? "bg-secondary text-white" : active ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {complete ? <CheckCircle2 className="h-4 w-4" /> : stepFor(level).n}
                      </span>
                      <span className={`text-center text-[11px] font-semibold leading-tight ${active ? "text-primary" : "text-muted-foreground"}`}>
                        Step {stepFor(level).n}: {stepFor(level).label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Critical path strip (remaining durations over prerequisites) */}
            {critical.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-4 text-xs text-muted-foreground">
                <span className="font-bold uppercase tracking-wider text-primary">Critical path</span>
                <GitBranch className="h-3.5 w-3.5" />
                <span className="flex flex-wrap items-center gap-1">
                  {critical.map((c, i) => (
                    <span key={c.code} className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-foreground">
                        {c.title} <span className="text-muted-foreground">({c.days}d)</span>
                      </span>
                      {i < critical.length - 1 && <ArrowRight className="h-3 w-3" />}
                    </span>
                  ))}
                  <span className="ml-1 whitespace-nowrap text-muted-foreground">
                    — {readiness?.remaining_critical_days ?? critical.reduce((n, c) => n + c.days, 0)} business days remaining
                  </span>
                </span>
              </div>
            )}

            {/* Plan views: checklist/timeline + dependency map */}
            <div id="onboarding-dag" className="scroll-mt-24">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Plan views</h2>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={view === "timeline" ? "default" : "outline"}
                    onClick={() => setView("timeline")}
                  >
                    <LayoutList className="h-3.5 w-3.5" /> Checklist timeline
                  </Button>
                  <Button size="sm" variant={view === "dag" ? "default" : "outline"} onClick={() => setView("dag")}>
                    <Network className="h-3.5 w-3.5" /> Dependency map
                  </Button>
                </div>
              </div>

              {view === "timeline" && (
                <div className="mt-4 flex flex-col gap-3">
                  {columns.map((col, level) => (
                    <div key={level} className="rounded-lg bg-white p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${col.every((t) => t.state === "done" || t.state === "waived") ? "bg-secondary text-white" : "bg-foreground text-white"}`}>
                          {stepFor(level).n}
                        </span>
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Step {stepFor(level).n}: {stepFor(level).label}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {col.filter((t) => t.state === "done" || t.state === "waived").length}/{col.length} done
                        </span>
                      </div>
                      <div className="flex flex-col gap-3">
                        {col.map((task) => renderTaskCard(task))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {view === "dag" && (
                <>
                  <div className="mt-4 flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" aria-label="Previous step" onClick={() => dagRef.current?.scrollBy({ left: -420, behavior: "smooth" })}>
                      ‹ Prev
                    </Button>
                    <Button size="sm" variant="outline" aria-label="Next step" onClick={() => dagRef.current?.scrollBy({ left: 420, behavior: "smooth" })}>
                      Next ›
                    </Button>
                  </div>
                  <div ref={dagRef} className="mt-4 flex flex-col gap-6 overflow-x-auto pb-2 lg:flex-row lg:items-start">
                    {columns.map((col, level) => (
                      <div key={level} className="min-w-full lg:min-w-[300px] lg:flex-1">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-xs font-bold text-white">{stepFor(level).n}</span>
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Step {stepFor(level).n}: {stepFor(level).label}</span>
                        </div>
                        <div className="flex flex-col gap-3">
                          {col.map((task) => renderTaskCard(task))}
                        </div>
                        {level < columns.length - 1 && (
                          <ArrowRight className="mx-auto my-3 hidden h-5 w-5 text-muted-foreground lg:block" strokeWidth={2.5} />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-lg bg-muted p-4 text-xs leading-relaxed text-muted-foreground">
              <button
                type="button"
                onClick={() => setGovOpen((v) => !v)}
                className="flex w-full items-center justify-between text-left font-bold text-foreground"
                aria-expanded={govOpen}
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Governance &amp; safeguards
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${govOpen ? "" : "-rotate-90"}`} />
              </button>
              {govOpen && (
                <ul className="mt-3 flex list-none flex-col gap-1.5">
                  <li>Defined task ownership: employee, manager, HR, or IT Security — HR never touches service-owner tasks, and employees cannot claim IT provisioning.</li>
                  <li>Version-bound approvals: approvals bind to the exact plan version+hash; regenerating or adapting invalidates approvals and preserves completed work via an explicit mapping.</li>
                  <li>Blocker detection: blockers can be reported in parallel; each must be resolved separately — no out-of-order completion.</li>
                  <li>Readiness is an estimate, never a guarantee.</li>
                </ul>
              )}
            </div>
          </div>
        )}

        {selected && !planData && role === "it_security" && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
            <KeyRound className="h-8 w-8 text-muted-foreground" strokeWidth={2} />
            <p className="text-sm text-muted-foreground">
              No adaptive plan yet for this employee. Plans are created from an approved role — IT
              executes the provisioning and access tasks once a plan exists.
            </p>
          </div>
        )}

        {selected && !planData && role !== "employee" && role !== "it_security" && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
            <XCircle className="h-8 w-8 text-muted-foreground" strokeWidth={2} />
            <p className="text-sm text-muted-foreground">
              No adaptive plan yet. Plans are built only from an approved application (role relationship).
            </p>
            <Button onClick={() => void build(false)} disabled={busy === "gen"}>
              <RefreshCw className="h-4 w-4" /> Build plan
            </Button>
          </div>
        )}

        {!selected && role !== "employee" && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
            <Users className="h-8 w-8 text-primary" strokeWidth={2.5} />
            <p className="text-sm text-muted-foreground">Select an employee to view their adaptive onboarding plan.</p>
          </div>
        )}
      </div>

      {/* Batch D (D1): bounded journey summary (no forced dependency-graph dive). */}
      {summaryTwin && queue.data && (() => {
        const journey = queue.data.journeys.find((j) => j.twin_id === summaryTwin);
        return journey ? (
          <JourneySummaryDialog
            journey={journey}
            people={peopleById}
            onClose={() => setSummaryTwin(null)}
            onOpenPlan={openJourneyPlan}
          />
        ) : null;
      })()}

      {/* Batch D (D3): compare up to three journeys. */}
      {compareOpen && queue.data && (() => {
        const journeys = queue.data.journeys.filter((j) => compareSet.has(j.twin_id)).slice(0, 3);
        return journeys.length >= 2 ? (
          <CompareDialog
            journeys={journeys}
            people={peopleById}
            onClose={() => setCompareOpen(false)}
            onOpenPlan={openJourneyPlan}
          />
        ) : null;
      })()}
    </AppShell>
  );
}

function inferSkill(task: PlanTaskView): string {
  // Skill name from the learning/verification task's why-evidence fact or title.
  const fact = task.why_evidence?.source_evidence?.find((s) => s.source_type === "role_fit" || s.source_type === "assessment");
  const m = fact?.fact?.match(/\b(\w+(?:\s+\w+)*)\b/);
  if (task.task_code.startsWith("learn_") || task.task_code.startsWith("verify_")) {
    const codeSkill = task.task_code.replace(/^(learn|verify)_/, "").replace(/_reopen$/, "");
    if (codeSkill && codeSkill !== "survey") return codeSkill;
  }
  return (m?.[1] ?? task.title).replace(/^(First contribution using|Verification:|Upskilling plan:|Re-learning:)\s*/i, "");
}
