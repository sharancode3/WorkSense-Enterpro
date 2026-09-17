import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Briefcase,
  FileSearch,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  ScrollText,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { ROLE_LABEL } from "@/lib/rbac";
import type { Twin } from "@/lib/api";

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
}: {
  label: string;
  value: number | string | null;
  tone: "primary" | "secondary" | "accent" | "muted" | "dark";
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
    </div>
  );
}

const MODULES = [
  { icon: LayoutDashboard, title: "Executive Decision Dashboard", desc: "Workforce-wide signals and KPIs." },
  { icon: FileSearch, title: "Recruitment Intelligence", desc: "Rank candidates against requisitions." },
  { icon: ListChecks, title: "Adaptive Onboarding", desc: "Personalized DAG journeys per role." },
  { icon: MessageSquareText, title: "Policy Studio", desc: "Source-backed policy Q&A." },
  { icon: GitBranch, title: "Skill Intelligence Graph", desc: "Skills vs. current and future needs." },
  { icon: ScrollText, title: "Audit Trail", desc: "Every decision, every transition." },
];

function ModuleStubs({ role }: { role: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {MODULES.map(({ icon: Icon, title, desc }) => {
        const open = role === "hr_executive" && title === "Skill Intelligence Graph";
        const card = (
          <div className="group flex h-full flex-col gap-3 rounded-lg bg-muted p-5 transition-all duration-200 hover:scale-[1.02]">
            <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white text-primary transition-transform duration-200 group-hover:scale-110">
              <Icon className="h-6 w-6" strokeWidth={2.5} />
            </span>
            <div>
              <h3 className="font-bold text-foreground">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </div>
            <span
              className={`mt-auto inline-flex w-fit items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                open ? "bg-primary text-white" : "bg-foreground text-white"
              }`}
            >
              {open ? "Open explorer" : "Phase 1+"}
            </span>
          </div>
        );
        return open ? (
          <Link key={title} to="/graph" className="block">
            {card}
          </Link>
        ) : (
          <div key={title}>{card}</div>
        );
      })}
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

  const hrStats = useQuery({
    queryKey: ["hr-stats"],
    enabled: role === "hr_executive",
    queryFn: async () => {
      const [recs, reqs, headcount, journeys] = await Promise.all([
        supabase.from("recommendations").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
        supabase.from("job_requisitions").select("id", { count: "exact", head: true }),
        supabase.from("digital_twins").select("id", { count: "exact", head: true }).eq("status", "active").in("role", ["employee", "manager"]),
        supabase.from("onboarding_journeys").select("id", { count: "exact", head: true }),
      ]);
      return {
        needsReview: recs.count ?? 0,
        openReqs: reqs.count ?? 0,
        headcount: headcount.count ?? 0,
        journeys: journeys.count ?? 0,
      };
    },
  });

  const hrRecs = useQuery({
    queryKey: ["hr-recs"],
    enabled: role === "hr_executive",
    queryFn: async () => {
      const { data } = await supabase
        .from("recommendations")
        .select("*")
        .eq("status", "needs_review")
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const managerTeam = useQuery({
    queryKey: ["team"],
    enabled: role === "manager",
    queryFn: async () => {
      const { data } = await supabase.from("digital_twins").select("*");
      return (data ?? []) as Twin[];
    },
  });

  const managerStats = useQuery({
    queryKey: ["manager-stats"],
    enabled: role === "manager",
    queryFn: async () => {
      const [recs, journeys] = await Promise.all([
        supabase.from("recommendations").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
        supabase.from("onboarding_journeys").select("id", { count: "exact", head: true }),
      ]);
      return { teamRecs: recs.count ?? 0, teamJourneys: journeys.count ?? 0 };
    },
  });

  const myJourney = useQuery({
    queryKey: ["my-journey"],
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

  const myRecs = useQuery({
    queryKey: ["my-recs"],
    enabled: role === "employee",
    queryFn: async () => {
      const { count } = await supabase
        .from("recommendations")
        .select("id", { count: "exact", head: true });
      return count ?? 0;
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
          <span className="text-xs font-bold uppercase tracking-wider text-primary">
            {org.data} · {ROLE_LABEL[role]}
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Welcome back, {twin.name.split(" ")[0]}.
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            {twin.job_title} · {twin.department ?? "—"}
          </p>
        </div>

        {/* Role-scoped stats */}
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {role === "hr_executive" && (
            <>
              <StatBlock label="Recommendations awaiting review" value={hrStats.data?.needsReview} tone="primary" />
              <StatBlock label="Open requisitions" value={hrStats.data?.openReqs} tone="secondary" />
              <StatBlock label="Active headcount" value={hrStats.data?.headcount} tone="accent" />
              <StatBlock label="Onboarding journeys" value={hrStats.data?.journeys} tone="dark" />
            </>
          )}
          {role === "manager" && (
            <>
              <StatBlock label="Team size" value={managerTeam.data?.length} tone="primary" />
              <StatBlock label="Team recommendations" value={managerStats.data?.teamRecs} tone="secondary" />
              <StatBlock label="Team onboarding journeys" value={managerStats.data?.teamJourneys} tone="accent" />
              <StatBlock label="Highest risk signal" value={(() => {
                const v = Math.max(
                  0,
                  ...(managerTeam.data ?? []).map((m) => signalValue(m, "workforce_review_signal") ?? 0)
                );
                return v || null;
              })()} tone="dark" />
            </>
          )}
          {role === "employee" && (
            <>
              <StatBlock label="Onboarding tasks done" value={myJourney.data ? `${doneCount}/${tasks.length}` : null} tone="primary" />
              <StatBlock label="Open recommendations" value={myRecs.data} tone="secondary" />
              <StatBlock label="Verified skills" value={twin.verified_skills.length} tone="accent" />
              <StatBlock label="Tenure" value={`${twin.tenure_months} mo`} tone="dark" />
            </>
          )}
        </div>

        {/* Main panels */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {role === "hr_executive" && (
            <div className="rounded-lg bg-white p-6 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-foreground">Recommendations awaiting review</h2>
                <Link to="/app" className="flex items-center gap-1 text-sm font-semibold text-primary">
                  Hub in Phase 1 <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              {hrRecs.data && hrRecs.data.length > 0 ? (
                <ul className="mt-4 flex flex-col divide-y-2 divide-border">
                  {hrRecs.data.map((r: RecRow) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 py-4">
                      <div>
                        <p className="font-bold text-foreground">{r.proposed_action?.title ?? r.category}</p>
                        <p className="text-sm text-muted-foreground">
                          {r.category.replace(/_/g, " ")} · requires {r.required_signoff_role?.replace("_", " ")}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                          r.urgency === "high"
                            ? "bg-destructive text-white"
                            : r.urgency === "medium"
                              ? "bg-accent text-foreground"
                              : "bg-muted text-foreground"
                        }`}
                      >
                        {r.urgency}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">No recommendations awaiting review.</p>
              )}
            </div>
          )}

          {role === "manager" && (
            <div className="rounded-lg bg-white p-6 lg:col-span-2">
              <h2 className="text-lg font-extrabold text-foreground">Team — workforce review signals</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A 0–100 decision-support indicator. Multiple indicators warrant HR review — never a prediction.
              </p>
              {managerTeam.data && managerTeam.data.length > 0 ? (
                <ul className="mt-4 flex flex-col divide-y-2 divide-border">
                  {managerTeam.data.map((m) => {
                    const v = signalValue(m, "workforce_review_signal");
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-4 py-4">
                        <div>
                          <p className="font-bold text-foreground">{m.name}</p>
                          <p className="text-sm text-muted-foreground">{m.job_title}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="h-3 w-28 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full ${v === null ? "w-0" : v >= 70 ? "bg-destructive" : v >= 45 ? "bg-accent" : "bg-secondary"}`}
                              style={{ width: v === null ? 0 : `${v}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-sm font-bold text-foreground">{v ?? "—"}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">No team members visible.</p>
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
                Full dashboards, the Recommendation Hub, and the Skill Graph land in Phase 1.
              </p>
            </div>
          </div>
        </div>

        {/* Module stubs */}
        <div className="mt-14">
          <h2 className="text-xl font-extrabold tracking-tight text-foreground">What's being built next</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            All modules share the same six entities — no disconnected tools.
          </p>
          <div className="mt-6">
            <ModuleStubs role={role} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
