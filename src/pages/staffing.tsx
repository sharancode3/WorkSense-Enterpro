import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { fetchStaffingComparison, type StaffingOption } from "@/lib/api";
import { can } from "@/lib/rbac";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Scale,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

const OPTION_TONE: Record<string, { cls: string; icon: typeof Users }> = {
  hire: { cls: "bg-primary text-white", icon: Users },
  move: { cls: "bg-secondary text-white", icon: TrendingUp },
  upskill: { cls: "bg-accent text-foreground", icon: CheckCircle2 },
  hybrid: { cls: "bg-foreground text-white", icon: Scale },
};

function OptionCard({ opt, deadline }: { opt: StaffingOption; deadline: number }) {
  const tone = OPTION_TONE[opt.id] ?? OPTION_TONE.hire;
  const onTime = opt.time_to_ready_days <= deadline;
  return (
    <div className="flex h-full flex-col gap-4 rounded-lg bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-md ${tone.cls}`}>
          <tone.icon className="h-5 w-5" strokeWidth={2.5} />
        </span>
        <span
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
            onTime ? "bg-secondary/15 text-secondary" : "bg-destructive/10 text-destructive"
          }`}
        >
          {onTime ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
          {onTime ? "Fits window" : "Risks window"}
        </span>
      </div>
      <div>
        <h3 className="text-lg font-extrabold text-foreground">{opt.label}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{opt.source}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-muted p-3">
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3 w-3" /> Coverage
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{opt.coverage_pct}%</p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <CalendarClock className="h-3 w-3" /> To ready
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{opt.time_to_ready_days}d</p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Wallet className="h-3 w-3" /> Cost*
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">${opt.cost_usd.toLocaleString()}</p>
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${tone.cls} transition-all duration-500`}
          style={{ width: `${opt.coverage_pct}%` }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Constraints</p>
        {opt.constraints.map((c) => (
          <p key={c} className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" /> {c}
          </p>
        ))}
        {opt.note && <p className="mt-1 text-xs italic text-muted-foreground">{opt.note}</p>}
      </div>
    </div>
  );
}

export default function StaffingPlanner() {
  const { role } = useAuth();
  const comp = useQuery({
    queryKey: ["staffing-comparison", role],
    queryFn: () => fetchStaffingComparison(),
    staleTime: 30_000,
  });

  if (role && !can(role, "view_all_workforce") && !can(role, "view_team")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Staffing planner access only</h1>
          <p className="text-muted-foreground">The staffing planner is restricted to HR and People Managers.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Staffing planner · demo scenario</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            A ready team in six weeks.
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Compare Hire / Move / Upskill / Hybrid against one open role. Coverage is computed
            deterministically from verified skills; cost and time are explicitly labeled demo
            assumptions — planning estimates, not guarantees.
          </p>
        </div>

        {comp.isLoading && (
          <div className="mt-8 flex items-center gap-3 rounded-lg bg-muted p-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> Computing coverage from live skill records…
          </div>
        )}
        {comp.error && (
          <div className="mt-8 rounded-lg bg-destructive/10 p-6 text-sm text-destructive">
            Staffing comparison unavailable: {comp.error instanceof Error ? comp.error.message : "unknown error"}
          </div>
        )}

        {comp.data && (
          <>
            {/* Demand */}
            <div className="mt-8 rounded-lg bg-foreground p-6 text-white">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/60">Open demand</p>
                  <h2 className="mt-1 text-2xl font-extrabold">{comp.data.scenario.req_title}</h2>
                  <p className="text-sm text-white/70">{comp.data.scenario.department} · {comp.data.scenario.allocation_note}</p>
                </div>
                <div className="rounded-md bg-white/10 px-4 py-3 text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Deadline</p>
                  <p className="text-xl font-extrabold">{comp.data.scenario.deadline_days} days</p>
                  <p className="text-xs text-white/70">{comp.data.scenario.target_date_note}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Required skills (target bar)</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {comp.data.scenario.demand.map((s) => (
                      <span key={s.skill} className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold">
                        {s.skill} · {s.target_proficiency}/5
                      </span>
                    ))}
                  </div>
                </div>
                {comp.data.scenario.future_skills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Future skills (12–24 mo)</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {comp.data.scenario.future_skills.map((s) => (
                        <span key={s.skill} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/80">
                          {s.skill} · {s.target_proficiency}/5
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Options */}
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {comp.data.options.map((opt) => (
                <OptionCard key={opt.id} opt={opt} deadline={comp.data.scenario.deadline_days} />
              ))}
            </div>

            {/* Honest footnotes */}
            <div className="mt-6 flex flex-col gap-3 rounded-lg bg-muted p-5 text-sm text-foreground">
              <p className="flex items-start gap-2 leading-relaxed">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span><b>Planning estimates, not guarantees.</b> {comp.data.planning_note}</span>
              </p>
              <p className="flex items-start gap-2 leading-relaxed text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                <span>
                  Skills that come from a resume are <b>claims</b> (verification_rigor: low) until a work
                  sample or reviewer confirms them. The planner never treats keywords as verified capability.
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Computed {new Date(comp.data.computed_at).toLocaleTimeString()} · deterministic engine · fictional demo data.
              </p>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
