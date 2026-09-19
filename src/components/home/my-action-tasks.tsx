// My action tasks: tasks assigned to me from dispatched recommendations
// (Phase 11). Owners act on their own tasks with evidence + rationale.
// Empty state renders only after a SUCCESSFUL empty query — never under
// loading, never under populated tasks, and never when the query failed.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, ShieldCheck, UserCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { actionTaskUpdate, type ActionTaskRow } from "@/lib/api";

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

export function MyActionTasks({ twinId }: { twinId: string }) {
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
