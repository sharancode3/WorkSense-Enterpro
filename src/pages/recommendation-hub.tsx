import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
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
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { can } from "@/lib/rbac";
import { recommendationDecision, recommendationScan, type RecommendationRow } from "@/lib/api";

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  needs_review: { label: "Needs review", cls: "bg-accent text-foreground" },
  approved: { label: "Approved", cls: "bg-primary text-white" },
  rejected: { label: "Rejected", cls: "bg-destructive text-white" },
  dispatched: { label: "Dispatched", cls: "bg-foreground text-white" },
  completed: { label: "Completed", cls: "bg-secondary text-white" },
};

const URGENCY_CLS: Record<string, string> = {
  critical: "bg-destructive text-white",
  high: "bg-destructive text-white",
  medium: "bg-accent text-foreground",
  low: "bg-muted text-foreground",
};

const CATEGORY_LABEL: Record<string, string> = {
  workforce_review: "Workforce Review · Retention Intervention",
  mobility: "Internal Mobility",
  recruitment: "Recruitment",
  onboarding_replan: "Onboarding Replan",
  policy: "Policy Question Escalation",
};

function RecommendationCard({
  rec,
  onAct,
  busy,
}: {
  rec: RecommendationRow;
  onAct: (decision: string) => void;
  busy: boolean;
}) {
  const [showAudit, setShowAudit] = useState(false);
  const chip = STATUS_CHIP[rec.status] ?? STATUS_CHIP.needs_review;

  const actions: { decision: string; label: string; variant?: "outline" | "secondary" | "default" }[] = [];
  if (rec.status === "needs_review") {
    actions.push({ decision: "approve", label: "Approve" });
    actions.push({ decision: "reject", label: "Reject", variant: "outline" });
    actions.push({ decision: "request_more_review", label: "Request more review", variant: "secondary" });
  } else if (rec.status === "approved") {
    actions.push({ decision: "dispatch", label: "Dispatch action" });
  } else if (rec.status === "dispatched") {
    actions.push({ decision: "complete", label: "Mark completed", variant: "secondary" });
  }

  return (
    <div className="rounded-lg bg-white p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${chip.cls}`}>
              {chip.label}
            </span>
            <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${URGENCY_CLS[rec.urgency] ?? "bg-muted text-foreground"}`}>
              {rec.urgency}
            </span>
          </div>
          <h3 className="mt-2 text-lg font-extrabold tracking-tight text-foreground">
            {CATEGORY_LABEL[rec.category] ?? rec.category.replace(/_/g, " ")}
          </h3>
          <p className="text-xs text-muted-foreground">
            Requires sign-off: {rec.required_signoff_role?.replace("_", " ") ?? "—"} ·{" "}
            {new Date(rec.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-bold text-foreground">
          {rec.proposed_action.title}
        </span>
      </div>

      {/* 1. Evidence */}
      <div className="mt-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <FileSearch className="h-4 w-4" /> Evidence — every source with a concrete fact
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rec.evidence_ledger.map((e) => (
            <div key={e.source} className="rounded-md bg-muted p-3">
              <span className="inline-block rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                {e.source}
              </span>
              <p className="mt-1.5 text-sm leading-snug text-foreground">{e.fact}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Reasoning */}
      <div className="mt-4 rounded-lg bg-primary/5 p-4">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
          <Lightbulb className="h-4 w-4" /> Reasoning
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">
          {rec.executive_summary || rec.proposed_action.executive_summary || "No synthesis available."}
        </p>
      </div>

      {/* 3. Recommended action */}
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
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-foreground text-[10px] font-bold text-white">
                  {s.order}
                </span>
                {s.action}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* 4. Human decision */}
      {actions.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t-2 border-border pt-4">
          <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> A short typed rationale is required before the state can change.
          </span>
          {actions.map((a) => (
            <Button
              key={a.decision}
              size="sm"
              variant={a.variant === "outline" ? "outline" : a.variant === "secondary" ? "secondary" : "default"}
              onClick={() => onAct(a.decision)}
              disabled={busy}
            >
              {a.label} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      )}

      {/* Audit trail */}
      <button
        type="button"
        onClick={() => setShowAudit((v) => !v)}
        className="mt-4 flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Activity className="h-4 w-4" /> Audit trail ({rec.audit_events.length})
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${showAudit ? "rotate-180" : ""}`} />
      </button>
      {showAudit && (
        <ul className="mt-2 flex flex-col divide-y divide-border rounded-md border border-border">
          {rec.audit_events.map((a, i) => (
            <li key={i} className="flex flex-col gap-0.5 px-3 py-2 text-xs">
              <span className="font-semibold text-foreground">
                {a.action.replace(/_/g, " ")}
                {a.before && a.after ? ` · ${a.before} → ${a.after}` : ""}
              </span>
              <span className="text-muted-foreground">
                {a.rationale || a.note || ""} · {a.actor} · {new Date(a.timestamp).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RecommendationHub() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const focusRec = searchParams.get("rec");
  const [dialog, setDialog] = useState<{ rec: RecommendationRow; decision: string } | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const recs = useQuery({
    queryKey: ["hub-recs", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase.from("recommendations").select("*").order("created_at", { ascending: false }).limit(20);
      return (data ?? []) as RecommendationRow[];
    },
  });

  // Drill-in from the dashboard feed: scroll to + highlight the target card.
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
          <p className="text-muted-foreground">The Recommendation Hub is for Managers, HR Business Partners and Administrators.</p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await recommendationScan();
      toast.success(
        res.created > 0
          ? `Scan created ${res.created} new recommendation(s): ${res.created_ids.join(", ")}`
          : "Scan found no new recommendations (all candidates already tracked)."
      );
      void qc.invalidateQueries({ queryKey: ["hub-recs", user?.id ?? "anon"] });
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
      const res = await recommendationDecision(dialog.rec.id, dialog.decision, rationale.trim());
      toast.success(
        res.effect
          ? `Status: ${res.status.replace(/_/g, " ")} — effect: ${res.effect}`
          : `Status: ${res.status.replace(/_/g, " ")}`
      );
      setDialog(null);
      setRationale("");
      void qc.invalidateQueries({ queryKey: ["hub-recs", user?.id ?? "anon"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Recommendation & Action Hub</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Evidence. Reasoning. <span className="text-primary">A human decides.</span>
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            The intelligence scan cross-references workforce signals, the skill graph, performance and
            onboarding state. The model writes the plain-English reasoning; the facts, urgency and state
            machine are deterministic — and every state change needs your typed rationale.
          </p>
        </div>

        {(role === "hr_executive" || role === "hr_partner") && (
          <div className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-foreground p-5 text-white">
            <p className="flex items-center gap-2 text-sm text-white/80">
              <GitBranch className="h-5 w-5 text-secondary" strokeWidth={2.5} />
              Re-scan the org's data sources for new recommendation candidates.
            </p>
            <Button onClick={() => void runScan()} disabled={scanning} variant="secondary" size="sm">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Run intelligence scan
            </Button>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-6">
          {recs.data && recs.data.length > 0 ? (
            recs.data.map((rec) => (
              <div key={rec.id} id={`rec-${rec.id}`} className="rounded-lg transition-all duration-500">
                <RecommendationCard
                  rec={rec}
                  busy={busy}
                  onAct={(decision) => {
                    setDialog({ rec, decision });
                    setRationale("");
                  }}
                />
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
              <MessageSquareText className="h-8 w-8 text-muted-foreground" strokeWidth={2} />
              <p className="text-sm text-muted-foreground">No recommendations yet — run the intelligence scan.</p>
            </div>
          )}
        </div>

        <p className="mt-8 rounded-lg bg-muted p-4 text-xs leading-relaxed text-muted-foreground">
          Dispatched actions have real internal effects: retention interventions flag the employee's
          DigitalTwin, mobility reviews mark them "under mobility review", and onboarding replans
          re-open the journey for replanning — each mirrored into the person's own audit trail.
        </p>
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialog?.decision === "approve" && <CheckCircle2 className="h-5 w-5 text-secondary" />}
              {dialog?.decision === "reject" && <XCircle className="h-5 w-5 text-destructive" />}
              {dialog?.decision === "dispatch" && <AlertTriangle className="h-5 w-5 text-accent" />}
              {(dialog?.decision === "request_more_review" || dialog?.decision === "complete") && (
                <MessageSquareText className="h-5 w-5 text-primary" />
              )}
              {dialog?.decision.replace(/_/g, " ")}
            </DialogTitle>
          </DialogHeader>
          {dialog && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {dialog.decision === "dispatch"
                  ? "Dispatching applies the action inside WorkSense (flag the DigitalTwin, re-open the journey, etc.) and records it in the audit trail."
                  : dialog.decision === "request_more_review"
                    ? "Keeps the recommendation in needs_review and records your request."
                    : `The recommendation will move to "${dialog.decision === "approve" ? "approved" : dialog.decision === "reject" ? "rejected" : "completed"}".`}
              </p>
              <Textarea
                rows={3}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Type your rationale (required)…"
              />
              <Button onClick={() => void confirm()} disabled={busy || rationale.trim().length < 5}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Confirm {dialog.decision.replace(/_/g, " ")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
