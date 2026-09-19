// Batch 3 (3.2/3.3): a compact, role-scoped "needs attention" surface above the
// shared dashboard. HR (and administrators) see organization journeys; managers
// see their own team — both come from the same server-scoped queue function.
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { OnboardingQueue } from "@/lib/contracts";

export function JourneyAttentionStrip({
  queue,
  title,
  scopeLabel,
}: {
  queue: OnboardingQueue | null;
  title: string;
  scopeLabel: string;
}) {
  const journeys = (queue?.journeys ?? []).filter((j) => j.pending_manager_approval || j.pending_hr_approval || j.stalled || j.overdue);
  const pending = journeys.filter((j) => j.pending_manager_approval || j.pending_hr_approval).length;
  const stalled = journeys.filter((j) => j.stalled).length;
  const overdue = journeys.filter((j) => j.overdue).length;
  if (journeys.length === 0) return null;

  return (
    <section aria-label={title} className="mt-10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
          <AlertTriangle className="h-5 w-5 text-accent" strokeWidth={2.5} /> {title}
        </h2>
        <span className="rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {scopeLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-white p-4 shadow-card">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pending approval</p>
          <p className="mt-1 text-3xl font-extrabold text-foreground">{pending}</p>
          <p className="text-[11px] text-muted-foreground">journeys awaiting manager/HR sign-off</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow-card">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stalled</p>
          <p className="mt-1 text-3xl font-extrabold text-foreground">{stalled}</p>
          <p className="text-[11px] text-muted-foreground">open blocker or actionable task overdue 7+ days</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow-card">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overdue</p>
          <p className="mt-1 text-3xl font-extrabold text-foreground">{overdue}</p>
          <p className="text-[11px] text-muted-foreground">actionable task past its due date</p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {journeys.slice(0, 5).map((j) => (
          <Link
            key={j.twin_id}
            to={`/onboarding?twin=${j.twin_id}`}
            className="group flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3.5 transition-all duration-200 hover:scale-[1.01] hover:shadow-card"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">{j.employee_name}</p>
              <p className="text-xs text-muted-foreground">
                {j.stall_reasons.length > 0
                  ? j.stall_reasons.join(" · ")
                  : j.pending_manager_approval
                    ? "awaiting manager approval"
                    : j.pending_hr_approval
                      ? "awaiting HR approval"
                      : `${j.overdue_count} overdue task${j.overdue_count > 1 ? "s" : ""}`}
              </p>
            </div>
            <span className="flex items-center gap-1 text-xs font-bold text-primary">
              Open journey <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
