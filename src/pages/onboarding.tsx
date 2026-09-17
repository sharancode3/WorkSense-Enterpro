import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { can, ROLE_LABEL } from "@/lib/rbac";
import {
  onboardingApprove,
  onboardingPlan,
  onboardingTask,
  type JourneyRow,
  type ScheduledTask,
} from "@/lib/api";

const STATUS_CHIP: Record<ScheduledTask["status"], { label: string; cls: string }> = {
  done: { label: "Done", cls: "bg-secondary text-white" },
  waived: { label: "Waived", cls: "bg-primary/15 text-primary" },
  blocked: { label: "Blocked", cls: "bg-destructive text-white" },
  pending: { label: "Required", cls: "bg-muted text-foreground" },
};

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TaskCard({
  task,
  canAct,
  canComplete,
  journeyActive,
  depsDone,
  blockerOpen,
  blockerText,
  onOpenBlocker,
  onBlockerChange,
  onBlockerSubmit,
  onComplete,
  onResolve,
  busy,
}: {
  task: ScheduledTask;
  canAct: boolean;
  canComplete: boolean;
  journeyActive: boolean;
  depsDone: boolean;
  blockerOpen: boolean;
  blockerText: string;
  onOpenBlocker: () => void;
  onBlockerChange: (v: string) => void;
  onBlockerSubmit: () => void;
  onComplete: () => void;
  onResolve: () => void;
  busy: boolean;
}) {
  const chip = STATUS_CHIP[task.status];
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-white p-4 transition-all duration-200 hover:scale-[1.02]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold leading-snug text-foreground">{task.title}</p>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${chip.cls}`}>
          {chip.label}
        </span>
      </div>

      {task.waived && task.skill && (
        <p className="flex items-center gap-1 text-[11px] text-primary">
          <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
          Waived — verified {task.skill} at/above target {task.target_proficiency}
        </p>
      )}
      {task.non_waivable && (
        <p className="text-[11px] text-muted-foreground">Non-waivable — required by policy</p>
      )}

      {task.depends_on.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          needs: {task.depends_on.join(", ")}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{fmt(task.start_date)} → {fmt(task.end_date)}</span>
        {typeof task.duration_days === "number" && <span>{task.duration_days}d</span>}
      </div>

      {task.blocked && (
        <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive">
          <AlertTriangle className="mr-1 inline h-3 w-3" /> {task.blocked.note}
          <span className="block text-destructive/80">reported by {task.blocked.reported_by}</span>
        </p>
      )}

      {canAct && task.status === "blocked" && (
        <Button size="sm" variant="outline" onClick={onResolve} disabled={busy}>
          <RefreshCw className="h-3.5 w-3.5" /> Resolve & recompute
        </Button>
      )}

      {canAct && task.status !== "done" && task.status !== "blocked" && task.status !== "waived" && (
        <div className="flex flex-col gap-2">
          {blockerOpen ? (
            <div className="flex flex-col gap-2">
              <Textarea
                rows={2}
                value={blockerText}
                onChange={(e) => onBlockerChange(e.target.value)}
                placeholder={`Report a blocker (e.g. "${task.title} — waiting on…")`}
                className="h-auto min-h-0 text-xs"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={onBlockerSubmit} disabled={busy || !blockerText.trim()}>
                  Report blocker
                </Button>
              </div>
            </div>
          ) : canComplete ? (
            <Button size="sm" onClick={onComplete} disabled={busy}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete
            </Button>
          ) : (
            <p className="rounded-md bg-muted px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
              {!journeyActive
                ? "Requires Manager + HR approval before tasks can be completed."
                : !depsDone
                  ? "Waiting on prerequisites to complete."
                  : "Cannot complete this task yet."}
            </p>
          )}
        </div>
      )}

      {canAct && task.status !== "done" && task.status !== "blocked" && task.status !== "waived" && !blockerOpen && canComplete && (
        <Button size="sm" variant="ghost" onClick={onOpenBlocker} disabled={busy}>
          <AlertTriangle className="h-3.5 w-3.5" /> Report blocker
        </Button>
      )}
    </div>
  );
}

export default function Onboarding() {
  const { role, twin, user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>("");
  const [blockerState, setBlockerState] = useState<{ taskId: string; open: boolean; text: string }>({
    taskId: "",
    open: false,
    text: "",
  });
  const [busy, setBusy] = useState<string | null>(null);

  const canView = role ? can(role, "view_onboarding") : false;

  const employees = useQuery({
    queryKey: ["onb-employees"],
    enabled: canView && role !== "employee",
    queryFn: async () => {
      const { data } = await supabase.from("digital_twins").select("id, name, role, job_title").in("role", ["employee"]).order("name");
      return (data ?? []) as { id: string; name: string; role: string; job_title: string | null }[];
    },
  });

  // Manager / HR pick an employee; employees see themselves.
  useEffect(() => {
    if (role === "employee" && twin && !selected) setSelected(twin.id);
  }, [role, twin, selected]);

  const journey = useQuery({
    queryKey: ["journey", selected],
    enabled: !!selected && canView,
    queryFn: async () => {
      const { data } = await supabase.from("onboarding_journeys").select("*").eq("twin_id", selected).maybeSingle();
      return (data ?? null) as JourneyRow | null;
    },
  });

  // Auto-generate the plan for the employee's own journey if it is missing/draft.
  const needGen = selected === twin?.id && role === "employee" && journey.data && journey.data.status === "draft";
  useEffect(() => {
    if (needGen) {
      void (async () => {
        try {
          await onboardingPlan(selected);
          void qc.invalidateQueries({ queryKey: ["journey", selected] });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Plan generation failed");
        }
      })();
    }
  }, [needGen, selected, qc]);

  const generate = async () => {
    if (!selected) return;
    setBusy("gen");
    try {
      await onboardingPlan(selected);
      toast.success("Onboarding plan generated — awaiting dual approval.");
      void qc.invalidateQueries({ queryKey: ["journey", selected] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!journey.data) return;
    setBusy("approve");
    try {
      const res = await onboardingApprove(journey.data.id);
      toast.success(res.status === "active" ? "Plan active — both approvals received." : "Approval recorded.");
      void qc.invalidateQueries({ queryKey: ["journey", selected] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  };

  const act = async (taskId: string, action: "complete" | "block" | "resolve", note?: string) => {
    if (!journey.data) return;
    setBusy(`${action}-${taskId}`);
    try {
      await onboardingTask(journey.data.id, taskId, action, note);
      toast.success(action === "block" ? "Blocker reported — downstream dates recomputed." : "Task updated.");
      setBlockerState({ taskId: "", open: false, text: "" });
      void qc.invalidateQueries({ queryKey: ["journey", selected] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const columns = useMemo(() => {
    const tasks = journey.data?.tasks ?? [];
    // Resilient wave computation: use stored topological_level, else derive
    // from depends_on depth so legacy/seed plans still render correctly.
    const levelOf = new Map<string, number>();
    const resolveLevel = (t: ScheduledTask): number => {
      const known = levelOf.get(t.id);
      if (known !== undefined) return known;
      if (typeof t.topological_level === "number") {
        levelOf.set(t.id, t.topological_level);
        return t.topological_level;
      }
      const depLevel = (t.depends_on ?? [])
        .map((d) => {
          const dep = tasks.find((x) => x.id === d);
          return dep ? resolveLevel(dep) + 1 : 0;
        })
        .reduce((m, l) => Math.max(m, l), 0);
      levelOf.set(t.id, depLevel);
      return depLevel;
    };
    const maxLevel = tasks.reduce((m, t) => Math.max(m, resolveLevel(t)), -1);
    const cols: ScheduledTask[][] = Array.from({ length: maxLevel + 1 }, () => []);
    for (const t of tasks) cols[resolveLevel(t)]?.push(t);
    return cols;
  }, [journey.data]);

  const isOwner = selected === twin?.id;
  const isManagerOf = role === "manager" && journey.data && twin ? twin.id !== journey.data.twin_id : false;
  const canAct = role === "employee" ? isOwner : role === "manager" || role === "hr_executive" || role === "hr_partner";
  const canApprove = role === "manager" || role === "hr_executive";

  if (!canView) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Onboarding access only</h1>
          <p className="text-muted-foreground">This center is for employees and their managers/HR.</p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const plan = journey.data?.plan;
  const approvals = plan?.approvals ?? [];
  const mgrApproved = approvals.some((a) => a.role === "manager" && a.approved);
  const hrApproved = approvals.some((a) => a.role === "hr_executive" && a.approved);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Adaptive Onboarding Center</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Personalized journeys, <span className="text-primary">deterministically</span> scheduled.
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Kahn's topological scheduler builds the plan; the Bloom-style waiver rule skips what you
            already prove; every approval and blocker is audited.
          </p>
        </div>

        {/* Employee selector for manager/HR */}
        {role !== "employee" && (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Users className="h-5 w-5 text-primary" strokeWidth={2.5} />
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="h-12 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
            >
              <option value="">Select an employee…</option>
              {(employees.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.job_title ?? "Employee"}
                </option>
              ))}
            </select>
            {journey.data && journey.data.status === "draft" && (
              <Button onClick={() => void generate()} disabled={busy === "gen"}>
                {busy === "gen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Generate plan
              </Button>
            )}
          </div>
        )}

        {role === "employee" && journey.data && journey.data.status === "draft" && (
          <div className="mt-8 flex items-center gap-3 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> Generating your personalized onboarding plan…
          </div>
        )}

        {selected && journey.data && (
          <div className="mt-8 flex flex-col gap-6">
            {/* Approval banner */}
            <div className="rounded-lg bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Plan status
                  </p>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                        journey.data.status === "active"
                          ? "bg-secondary text-white"
                          : journey.data.status === "pending"
                            ? "bg-accent text-foreground"
                            : "bg-muted text-foreground"
                      }`}
                    >
                      {journey.data.status === "active" ? "Active" : journey.data.status === "pending" ? "Pending approval" : "Draft"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Fit vs role: current <b className="text-foreground">{Math.round((plan?.fit_current ?? 0) * 100)}</b> ·
                      future <b className="text-foreground">{Math.round((plan?.fit_future ?? 0) * 100)}</b>
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-4 text-sm">
                    <span className={`flex items-center gap-1.5 ${mgrApproved ? "text-secondary" : "text-muted-foreground"}`}>
                      <UserCheck className="h-4 w-4" /> Manager {mgrApproved ? "approved" : "pending"}
                    </span>
                    <span className={`flex items-center gap-1.5 ${hrApproved ? "text-secondary" : "text-muted-foreground"}`}>
                      <BadgeCheck className="h-4 w-4" /> HR Exec {hrApproved ? "approved" : "pending"}
                    </span>
                  </div>
                  {canApprove && journey.data.status !== "active" && (
                    <Button onClick={() => void approve()} disabled={busy === "approve"} size="sm">
                      {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      {journey.data.status === "draft" ? "Generate & approve" : "Approve as " + ROLE_LABEL[role ?? "employee"]}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* DAG view: columns by topological wave */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Dependency graph — wave by wave
              </h2>
              <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
                {columns.map((col, level) => (
                  <div key={level} className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-xs font-bold text-white">
                        {level}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Wave {level}
                      </span>
                    </div>
                    <div className="flex flex-col gap-3">
                      {col.map((task) => {
                        const depsDone = (task.depends_on ?? []).every((d) => tasks.find((x) => x.id === d)?.status === "done");
                        const journeyActive = journey.data?.status === "active";
                        return (
                          <TaskCard
                            key={task.id}
                            task={task}
                            canAct={canAct}
                            canComplete={journeyActive && depsDone && !task.waived}
                            journeyActive={journeyActive}
                            depsDone={depsDone}
                            blockerOpen={blockerState.taskId === task.id && blockerState.open}
                            blockerText={blockerState.taskId === task.id ? blockerState.text : ""}
                            onOpenBlocker={() => setBlockerState({ taskId: task.id, open: true, text: "" })}
                            onBlockerChange={(v) => setBlockerState((s) => ({ ...s, text: v }))}
                            onBlockerSubmit={() => void act(task.id, "block", blockerState.text)}
                            onComplete={() => void act(task.id, "complete")}
                            onResolve={() => void act(task.id, "resolve")}
                            busy={busy === `complete-${task.id}` || busy === `block-${task.id}` || busy === `resolve-${task.id}`}
                          />
                        );
                      })}
                    </div>
                    {level < columns.length - 1 && (
                      <ArrowRight className="mx-auto my-3 hidden h-5 w-5 text-muted-foreground lg:block" strokeWidth={2.5} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <p className="rounded-lg bg-muted p-4 text-xs leading-relaxed text-muted-foreground">
              Waived tasks are proven by verified skills (Bloom-style rule, deterministic). Security,
              compliance sign-off and payroll can never be waived. Blockers recompute downstream dates
              through the same Kahn scheduler. Every approval and blocker is appended to the journey's
              audit trail.
            </p>
          </div>
        )}

        {selected && !journey.data && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
            <XCircle className="h-8 w-8 text-muted-foreground" strokeWidth={2} />
            <p className="text-sm text-muted-foreground">No onboarding journey for this employee yet.</p>
            {role !== "employee" && (
              <Button onClick={() => void generate()} disabled={busy === "gen"}>
                <RefreshCw className="h-4 w-4" /> Generate plan
              </Button>
            )}
          </div>
        )}

        {!selected && role !== "employee" && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
            <Users className="h-8 w-8 text-primary" strokeWidth={2.5} />
            <p className="text-sm text-muted-foreground">Select an employee to view their onboarding journey.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
