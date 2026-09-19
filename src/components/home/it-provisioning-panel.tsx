// Batch 3 (3.6): a focused IT Provisioning workspace — real server-scoped
// provisioning tasks plus employee identity (name, start date, manager). No
// readiness, gates or approvals cross the boundary into this role home.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Server } from "lucide-react";
import type { OnboardingQueue } from "@/lib/contracts";
import { TASK_STATE_META } from "@/lib/onboarding-progress";
import { deriveItQueueCounts, filterItProvisioning, upcomingStarts, type ItQueueFilter } from "@/lib/it-provisioning";
import { StatBlock } from "./stat-block";

export function ItProvisioningPanel({ queue }: { queue: OnboardingQueue | null }) {
  const now = new Date().toISOString();
  const items = useMemo(() => queue?.provisioning ?? [], [queue]);
  const counts = deriveItQueueCounts(items, now);
  const starts = upcomingStarts(queue?.people ?? [], now);
  const names = useMemo(() => new Map((queue?.people ?? []).map((p) => [p.twin_id, p.name])), [queue]);
  const [filter, setFilter] = useState<ItQueueFilter>("all");
  const [search, setSearch] = useState("");
  const visible = useMemo(() => filterItProvisioning(items, names, filter, search, now), [items, names, filter, search, now]);
  const FILTERS: { key: ItQueueFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "ready", label: "Ready" },
    { key: "blocked", label: "Blocked" },
    { key: "overdue", label: "Overdue" },
    { key: "done", label: "Completed" },
  ];

  return (
    <section aria-label="IT provisioning workspace" className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
            <Server className="h-5 w-5 text-primary" strokeWidth={2.5} /> Provisioning workspace
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Laptop, SSO and access work that unblocks approved new-hire onboarding — complete tasks with evidence in the onboarding center.
          </p>
        </div>
        <Link to="/onboarding" className="flex items-center gap-1 text-sm font-bold text-primary">
          Open provisioning queue <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatBlock label="Ready" value={counts.ready} tone="primary" definition="Tasks with prerequisites satisfied, ready to action." />
        <StatBlock label="In progress" value={counts.in_progress} tone="dark" definition="Started but not yet completed with evidence." />
        <StatBlock label="Blocked" value={counts.blocked} tone="muted" definition="Waiting on an upstream dependency or a reported blocker." />
        <StatBlock label="Overdue" value={counts.overdue} tone="muted" definition="Actionable task past its due date." />
        <StatBlock label="Completed" value={counts.done} tone="subtle" definition="Accepted provisioning work across in-scope journeys." />
      </div>

      {starts.length > 0 && (
        <div className="mt-4 rounded-lg bg-white p-4 shadow-card">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> Upcoming start dates (next 14 days)
          </h3>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {starts.map((s) => (
              <li key={s.twin_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-bold text-foreground">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  starts {new Date(s.start_date).toLocaleDateString()}
                  {s.manager_name ? ` · manager ${s.manager_name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-lg bg-white p-5 shadow-card">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Provisioning & access tasks</p>
          <span className="rounded-md bg-foreground px-2 py-0.5 text-[10px] font-bold text-white">{items.length}</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter provisioning tasks">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  filter === f.key ? "bg-foreground text-white" : "bg-muted text-muted-foreground hover:bg-border"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or task…"
            aria-label="Search provisioning tasks by employee or task"
            className="h-9 w-full shrink-0 rounded-md border border-border bg-white px-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-56"
          />
        </div>
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {items.length === 0
              ? "No provisioning or access tasks are waiting right now. New-hire work appears here once their plan is approved."
              : "No tasks match this filter."}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {visible.map((t) => {
              const chip = TASK_STATE_META[t.state as keyof typeof TASK_STATE_META] ?? TASK_STATE_META.pending;
              return (
                <li key={`${t.twin_id}-${t.task_code}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      for {names.get(t.twin_id) ?? "employee"}
                      {t.blockers && t.blockers.length > 0 ? ` · ${t.blockers.length} blocker(s)` : ""}
                      {t.depends_on && t.depends_on.length > 0 ? ` · waits on ${t.depends_on.join(", ")}` : ""}
                      {t.evidence_requirements && t.evidence_requirements.length > 0 ? " · evidence required" : ""}
                      {` · due ${t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
