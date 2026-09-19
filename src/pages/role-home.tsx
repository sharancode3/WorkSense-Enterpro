// Role home — the /app landing per persona. Keeps only the page composition;
// every panel it renders lives in src/components/home/*.
import { useQuery } from "@tanstack/react-query";
import { Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { ExecutiveDashboard } from "@/components/executive-dashboard";
import { MyWorkFeed } from "@/components/my-work-feed";
import { RoleScopeCallout } from "@/components/role-scope-callout";
import { AdminGovernancePanel } from "@/components/home/admin-governance-panel";
import { HRLifecyclePanel } from "@/components/home/hr-lifecycle-panel";
import { ItProvisioningPanel } from "@/components/home/it-provisioning-panel";
import { JourneyAttentionStrip } from "@/components/home/journey-attention-strip";
import { ManagerTeamPanel } from "@/components/home/manager-team-panel";
import { MyActionTasks } from "@/components/home/my-action-tasks";
import { StatBlock } from "@/components/home/stat-block";
import { ROLE_LABEL } from "@/lib/rbac";
import { fetchMyWork, onboardingQueue } from "@/lib/api";
import { decode, planTaskViewSchema, planViewSchema, requisitionRowSchema } from "@/lib/contracts";
import { nextActionTask, derivePlanCounts, TASK_STATE_META } from "@/lib/onboarding-progress";

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
