// §52: HR home differentiator — an organization-lifecycle strip derived from
// the SAME org-scoped queries the rest of the home uses (onboarding queue +
// assigned-work feed). HR partner/administrator scope is the whole org, so
// every count here is org-wide by construction. This is the counterweight to
// the manager team roster: HR thinks in organization-wide lifecycle stages.
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Database, ListChecks, Users } from "lucide-react";
import type { MyWorkResult, WorkItemType } from "@/lib/api";
import type { OnboardingQueue } from "@/lib/contracts";
import type { Role } from "@/lib/rbac";

export function HRLifecyclePanel({ queue, myWork, role }: { queue: OnboardingQueue | null; myWork: MyWorkResult | null; role: Role }) {
  const journeys = queue?.journeys ?? [];
  const items = myWork?.items ?? [];
  const count = (t: WorkItemType) => items.filter((i) => i.type === t).length;
  const awaiting = journeys.filter((j) => j.pending_manager_approval || j.pending_hr_approval).length;
  const stalled = journeys.filter((j) => j.stalled || j.overdue).length;
  const attention = journeys.filter((j) => j.stalled || j.overdue || j.pending_manager_approval || j.pending_hr_approval).slice(0, 5);

  const stages = [
    {
      to: "/onboarding",
      icon: ListChecks,
      label: "Onboarding journeys",
      value: journeys.length,
      sub: `${awaiting} awaiting approval · ${stalled} stalled`,
      definition: "Active adaptive onboarding plans across the whole organization.",
    },
    {
      to: "/workforce",
      icon: Users,
      label: "Review cases in scope",
      value: count("review_case"),
      sub: "flagged by the Workforce Review Index",
      definition: "Longitudinal review cases across the org assigned to your work feed.",
    },
    {
      to: "/hub",
      icon: CheckCircle2,
      label: "Approvals awaiting decision",
      value: count("approval_request"),
      sub: "recommendations needing a typed human decision",
      definition: "Org-wide recommendations at needs_review that you approve or reject.",
    },
    ...(role === "hr_executive"
      ? [
          {
            to: "/workforce/data-quality",
            icon: Database,
            label: "Data quality alerts",
            value: count("data_quality_alert"),
            sub: "unverified skill claims",
            definition: "Skill assertions that must not read as verified evidence — administrators only.",
          },
        ]
      : []),
  ];

  return (
    <section aria-label="Organization lifecycle" className="mt-10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
          <Activity className="h-5 w-5 text-primary" strokeWidth={2.5} /> Organization lifecycle
        </h2>
        <span className="rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Organization scope</span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Lifecycle stages across the entire organization — every count comes from your org-scoped work feed and onboarding
        queue. Managers see the same page filtered to their team only.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
            aria-label={`${s.label}: ${s.value}`}
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" strokeWidth={2.5} />
              </span>
              <span className="text-2xl font-extrabold tracking-tight text-foreground">{s.value}</span>
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">{s.label}</h3>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.sub}</p>
            </div>
            <span className="flex items-center gap-1 text-xs font-bold text-primary">
              Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
      {attention.length > 0 && (
        <div className="mt-4 rounded-lg bg-white p-4 shadow-card">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-accent" /> Journeys needing an HR decision
          </h3>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {attention.map((j) => (
              <li key={j.twin_id}>
                <Link
                  to={`/onboarding?twin=${j.twin_id}`}
                  className="group flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span className="font-bold text-foreground">{j.employee_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {j.stall_reasons.length > 0
                      ? j.stall_reasons.join(" · ")
                      : j.pending_hr_approval
                        ? "awaiting HR approval"
                        : j.pending_manager_approval
                          ? "awaiting manager approval"
                          : `${j.overdue_count} overdue task${j.overdue_count > 1 ? "s" : ""}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
