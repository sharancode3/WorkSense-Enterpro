import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  GitBranch,
  ListChecks,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { ExecutiveDashboard } from "@/components/executive-dashboard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { can, ROLE_LABEL, type Role } from "@/lib/rbac";
import { actionTaskUpdate, type ActionTaskRow, type Twin } from "@/lib/api";

// My Action Tasks: tasks assigned to me from dispatched recommendations
// (Phase 11). Owners act on their own tasks with evidence + rationale.
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

  if (tasks.data && tasks.data.length === 0) return null;

  return (
    <div className="rounded-lg bg-white p-6">
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

interface RecRow {
  id: string;
  category: string;
  urgency: string;
  status: string;
  required_signoff_role: string | null;
  proposed_action: { title?: string } | null;
}

function signalValue(twin: Twin, type: string): number | null {
  const s = (twin.signals ?? []).find((x: { type?: string }) => x.type === type) as
    | { value?: number }
    | undefined;
  return typeof s?.value === "number" ? s.value : null;
}

function StatBlock({
  label,
  value,
  tone,
  definition,
}: {
  label: string;
  value: number | string | null;
  tone: "primary" | "secondary" | "accent" | "muted" | "dark";
  definition?: string;
}) {
  const cls = {
    primary: "bg-primary text-white",
    secondary: "bg-secondary text-white",
    accent: "bg-accent text-foreground",
    muted: "bg-muted text-foreground",
    dark: "bg-foreground text-white",
  }[tone];
  return (
    <div className={`flex flex-col justify-between gap-6 rounded-lg p-5 transition-all duration-200 hover:scale-[1.02] ${cls}`}>
      <span className={`text-xs font-bold uppercase tracking-wider ${tone === "dark" ? "text-white/70" : "text-foreground/60"}`}>
        {label}
      </span>
      <span className="text-4xl font-extrabold tracking-tight">{value ?? "—"}</span>
      {definition && (
        <span className={`text-[11px] leading-snug ${tone === "dark" ? "text-white/60" : "text-foreground/55"}`}>{definition}</span>
      )}
    </div>
  );
}

// Phase 12: honest per-role module grid — every card opens a module the role
// can actually reach (same predicates as the app-shell nav). Nothing locked,
// nothing shown as "Phase 1+" placeholders.
interface ModuleDef {
  title: string;
  desc: string;
  icon: typeof Users;
  to: string;
  show: (role: Role) => boolean;
}

const MODULES: ModuleDef[] = [
  {
    title: "Workforce review",
    desc: "Index-driven review cases with evidence-to-action trails.",
    icon: Users,
    to: "/workforce",
    show: (role) => can(role, "view_all_workforce") || can(role, "view_team") || role === "employee",
  },
  {
    title: "Recruitment",
    desc: "Requisitions, applications, interviews, and decisions.",
    icon: Briefcase,
    to: "/recruitment",
    show: (role) => can(role, "manage_recruitment"),
  },
  {
    title: "Onboarding",
    desc: "Adaptive journeys, approvals, and completion evidence.",
    icon: ListChecks,
    to: "/onboarding",
    show: (role) => can(role, "view_onboarding"),
  },
  {
    title: "Recommendation hub",
    desc: "Review, approve, and execute recommended actions.",
    icon: ShieldCheck,
    to: "/hub",
    show: (role) => can(role, "approve_recommendations"),
  },
  {
    title: "Policy studio",
    desc: "Source-backed policy questions and answers.",
    icon: MessageSquareText,
    to: "/policy",
    show: (role) => can(role, "use_policy_studio"),
  },
  {
    title: "Skill graph",
    desc: "Skills versus current and future needs.",
    icon: GitBranch,
    to: "/graph",
    show: (role) => can(role, "explore_skill_graph"),
  },
  {
    title: "Staffing planner",
    desc: "Hire / Move / Upskill / Hybrid with honest estimates.",
    icon: Users,
    to: "/staffing",
    show: (role) => can(role, "view_all_workforce") || can(role, "view_team"),
  },
  {
    title: "Access & users",
    desc: "Invite members, manage roles, and audit access changes.",
    icon: UserCheck,
    to: "/admin/access",
    show: (role) => can(role, "manage_users"),
  },
];

function ModuleGrid({ role }: { role: Role }) {
  const modules = MODULES.filter((m) => m.show(role));
  if (modules.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {modules.map(({ icon: Icon, title, desc, to }) => (
        <Link
          key={to}
          to={to}
          className="group flex h-full flex-col gap-3 rounded-lg bg-muted p-5 transition-all duration-200 hover:scale-[1.02]"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white text-primary transition-transform duration-200 group-hover:scale-110">
            <Icon className="h-6 w-6" strokeWidth={2.5} />
          </span>
          <div>
            <h3 className="font-bold text-foreground">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
          </div>
          <span className="mt-auto inline-flex w-fit items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white">
            Open <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function RoleHome() {
  const { role, twin } = useAuth();

  const org = useQuery({
    queryKey: ["org"],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("name").maybeSingle();
      return data?.name ?? "Your organization";
    },
  });

  const myJourney = useQuery({
    queryKey: ["my-journey", twin?.id ?? "anon"],
    enabled: role === "employee",
    queryFn: async () => {
      if (!twin) return null;
      const { data } = await supabase
        .from("onboarding_journeys")
        .select("*")
        .eq("twin_id", twin.id)
        .maybeSingle();
      return data ?? null;
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

  const recruiterData = useQuery({
    queryKey: ["recruiter", twin?.id ?? "anon"],
    enabled: role === "recruiter",
    queryFn: async () => {
      const [reqsRes, candidatesRes] = await Promise.all([
        supabase.from("job_requisitions").select("*"),
        supabase.from("digital_twins").select("id, name, role, status").eq("role", "candidate"),
      ]);
      const reqs = (reqsRes.data ?? []) as {
        id: string;
        title: string;
        department: string;
        status: string;
        applicants: { twin_id: string; stage: string; match_score: number | null }[];
      }[];
      const candidates = (candidatesRes.data ?? []) as { id: string; name: string }[];
      const openReqs = reqs.filter((r) => r.status === "open");
      const applicants = openReqs.flatMap((r) => r.applicants ?? []);
      const finalRound = applicants.filter((a) => a.stage === "final_round").length;
      const scored = applicants.filter((a) => typeof a.match_score === "number");
      const avgScore =
        scored.length > 0 ? scored.reduce((s, a) => s + (a.match_score ?? 0), 0) / scored.length : null;
      return { reqs, openReqs, candidates, applicants, finalRound, avgScore };
    },
  });

  if (!role || !twin) return null;

  const tasks = (myJourney.data?.tasks ?? []) as { id: string; title: string; status: string; depends_on: string[] }[];
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const nextTask = tasks.find((t) => t.status !== "done");

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

        {["hr_executive", "hr_partner", "manager"].includes(role) ? (
          <div className="mt-8">
            <ExecutiveDashboard />
          </div>
        ) : (
          <>
            {/* Role-scoped stats */}
            <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {role === "recruiter" && (
                <>
                  <StatBlock
                    label="Open requisitions"
                    value={recruiterData.data?.openReqs.length ?? null}
                    tone="primary"
                    definition="Requisitions with status open (on-hold/filled/closed excluded)."
                  />
                  <StatBlock label="Active candidates" value={recruiterData.data?.candidates.length} tone="secondary" definition="Candidate twins across the organization." />
                  <StatBlock label="In final round" value={recruiterData.data?.finalRound} tone="accent" definition="Applicants at final_round on open requisitions." />
                  <StatBlock
                    label="Avg applicant match"
                    value={recruiterData.data?.avgScore !== null && recruiterData.data?.avgScore !== undefined ? `${Math.round(recruiterData.data.avgScore * 100)}%` : null}
                    tone="dark"
                    definition="Mean Skill Graph match score across open-requisition applicants."
                  />
                </>
              )}
              {role === "employee" && (
                <>
                  <StatBlock
                    label="Onboarding tasks done"
                    value={myJourney.data ? `${doneCount}/${tasks.length}` : null}
                    tone="primary"
                    definition="Tasks completed in your active journey."
                  />
                  <StatBlock
                    label="Active recommendations"
                    value={myRecs.data}
                    tone="secondary"
                    definition="Your non-terminal recommendations (awaiting or in execution)."
                  />
                  <StatBlock label="Verified skills" value={twin.verified_skills.length} tone="accent" definition="Skills with high/medium-rigor evidence on your profile." />
                  <StatBlock
                    label="Workforce review index"
                    value={signalValue(twin, "workforce_review_index") !== null ? `${signalValue(twin, "workforce_review_index")}/100` : null}
                    tone="dark"
                    definition="Interpretable decision support — not a probability of leaving."
                  />
                </>
              )}
            </div>

            {/* Phase 11: task owners act on their assigned tasks here */}
            {(role === "employee" || role === "recruiter") && (
              <div className="mt-8">
                <MyActionTasks twinId={twin.id} />
              </div>
            )}

            {/* Main panels */}
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {role === "recruiter" && (
                <div className="rounded-lg bg-white p-6 lg:col-span-2">
                  <h2 className="text-lg font-extrabold text-foreground">Recruitment pipeline</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Candidates ranked by the Skill Intelligence Graph match score, on open requisitions.
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
                                          : "bg-accent text-foreground"
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
                <div className="rounded-lg bg-white p-6 lg:col-span-2">
                  <h2 className="text-lg font-extrabold text-foreground">Your onboarding journey</h2>
                  {myJourney.data ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-sm font-semibold text-muted-foreground">
                        <span>Progress</span>
                        <span>
                          {doneCount}/{tasks.length} complete
                        </span>
                      </div>
                      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: tasks.length ? `${(doneCount / tasks.length) * 100}%` : "0%" }}
                        />
                      </div>
                      <ul className="mt-5 flex flex-col divide-y-2 divide-border">
                        {tasks.map((t) => (
                          <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                            <span className="text-sm font-medium text-foreground">{t.title}</span>
                            <span
                              className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                                t.status === "done"
                                  ? "bg-secondary text-white"
                                  : t.status === "in_progress"
                                    ? "bg-primary text-white"
                                    : "bg-muted text-foreground"
                              }`}
                            >
                              {t.status.replace(/_/g, " ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {nextTask && (
                        <p className="mt-4 rounded-md bg-muted px-4 py-3 text-sm text-foreground">
                          <span className="font-bold">Next up:</span> {nextTask.title}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">No active onboarding journey.</p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <div className="rounded-lg bg-foreground p-6 text-white">
                  <Activity className="h-6 w-6 text-secondary" strokeWidth={2.5} />
                  <h3 className="mt-3 text-base font-bold">Why this screen matters</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/80">
                    Every number here is read live through role-based access control — this is the
                    enforcement, not a mock.
                  </p>
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-muted p-6">
                  <Users className="h-8 w-8 text-primary" strokeWidth={2.5} />
                  <p className="text-sm leading-relaxed text-foreground">
                    The Workforce Review Index is interpretable decision support (0–100) — it flags
                    when a review conversation is warranted, never a probability of leaving.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Honest per-role module grid — nothing locked, no placeholders */}
        <div className="mt-14">
          <h2 className="text-xl font-extrabold tracking-tight text-foreground">Your modules</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you can open from here — access is enforced at the data layer, not hidden UI.
          </p>
          <div className="mt-6">
            <ModuleGrid role={role} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
