// §52: PEOPLE MANAGER home differentiator — a team roster derived from the SAME
// server-scoped onboarding queue that drives the attention strip and the
// onboarding center. Manager scope = recursive reporting subtree, enforced in
// the queue function. This panel is what makes the manager home people-centric
// (who is on my team and how are they onboarding) instead of a copy of HR.
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import type { OnboardingQueue } from "@/lib/contracts";

export function ManagerTeamPanel({ queue }: { queue: OnboardingQueue | null }) {
  const journeys = queue?.journeys ?? [];
  if (!queue || journeys.length === 0) return null;
  const awaiting = journeys.filter((j) => j.pending_manager_approval || j.pending_hr_approval).length;
  const attention = journeys.filter((j) => j.stalled || j.overdue).length;
  return (
    <section aria-label="My team" className="mt-10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
          <Users className="h-5 w-5 text-primary" strokeWidth={2.5} /> My team
        </h2>
        <span className="rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Team scope</span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        {journeys.length} team member{journeys.length === 1 ? "" : "s"} with an active onboarding plan
        {awaiting > 0 || attention > 0
          ? ` — ${attention} need${attention === 1 ? "s" : ""} attention, ${awaiting} awaiting approval.`
          : " — all on track."}{" "}
        HR sees the whole organization; this roster only ever shows your own reports.
      </p>
      <div className="mt-4 rounded-lg bg-white p-5 shadow-card">
        <div className="flex flex-col divide-y divide-border">
          {journeys.map((j) => {
            const chip =
              j.stalled || j.overdue
                ? { label: "Needs attention", cls: "bg-destructive text-white" }
                : j.pending_manager_approval || j.pending_hr_approval
                  ? { label: "Awaiting approval", cls: "bg-accent text-foreground" }
                  : { label: "On track", cls: "bg-secondary text-white" };
            return (
              <Link
                key={j.twin_id}
                to={`/onboarding?twin=${j.twin_id}`}
                className="group flex flex-wrap items-center justify-between gap-3 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {j.employee_name}
                    <span className="ml-2 text-xs font-semibold text-muted-foreground">
                      {[j.job_title, j.department].filter(Boolean).join(" · ") || "Team member"}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    started {new Date(j.start_date).toLocaleDateString()}
                    {j.status === "approved" ? "" : ` · plan ${j.status.replace(/_/g, " ")}`}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${j.readiness_pct}%` }} />
                    </div>
                    <span className="w-9 text-right text-[11px] font-bold text-muted-foreground">{j.readiness_pct}%</span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
