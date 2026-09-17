import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Layers,
  Loader2,
  TrendingUp,
  Users,
} from "lucide-react";
import { fetchDashboard, type DashboardData } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";

const URGENCY_CLS: Record<string, string> = {
  critical: "bg-destructive text-white",
  high: "bg-destructive text-white",
  medium: "bg-accent text-foreground",
  low: "bg-muted text-foreground",
};

function StatCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number | string;
  tone: "primary" | "secondary" | "accent" | "muted" | "dark" | "danger";
  sub?: string;
}) {
  const cls = {
    primary: "bg-primary text-white",
    secondary: "bg-secondary text-white",
    accent: "bg-accent text-foreground",
    muted: "bg-muted text-foreground",
    dark: "bg-foreground text-white",
    danger: "bg-destructive text-white",
  }[tone];
  const light = tone === "accent" || tone === "muted";
  return (
    <div className={`flex flex-col justify-between gap-4 rounded-lg p-5 transition-all duration-200 hover:scale-[1.02] ${cls}`}>
      <span className={`text-xs font-bold uppercase tracking-wider ${light ? "text-foreground/60" : "text-white/75"}`}>
        {label}
      </span>
      <div>
        <span className="text-4xl font-extrabold tracking-tight">{value}</span>
        {sub && <span className={`ml-2 text-xs font-semibold ${light ? "text-muted-foreground" : "text-white/70"}`}>{sub}</span>}
      </div>
    </div>
  );
}

function heatColor(pct: number): string {
  if (pct >= 0.8) return "bg-destructive text-white";
  if (pct >= 0.5) return "bg-destructive/70 text-white";
  if (pct >= 0.25) return "bg-accent text-foreground";
  return "bg-muted text-foreground";
}

export function ExecutiveDashboard() {
  const { role, user } = useAuth();
  const dash = useQuery({
    queryKey: ["dashboard", user?.id ?? "anon", role],
    queryFn: fetchDashboard,
  });

  if (dash.isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-muted p-8 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Aggregating live records…
      </div>
    );
  }

  if (dash.error || !dash.data) {
    return (
      <div className="rounded-lg bg-destructive/10 p-6 text-sm text-destructive">
        Dashboard unavailable: {dash.error instanceof Error ? dash.error.message : "unknown error"}
      </div>
    );
  }

  const d: DashboardData = dash.data;
  const isTeam = d.scope === "team";

  return (
    <div className="flex flex-col gap-10">
      {/* Recommended Actions feed — straight from Phase 6's needs_review */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
            <Layers className="h-5 w-5 text-secondary" strokeWidth={2.5} />
            Recommended Actions
          </h2>
          <Link to="/hub" className="flex items-center gap-1 text-sm font-semibold text-primary">
            Open Hub <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {d.recommendations.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            {d.recommendations.map((r) => (
              <Link
                key={r.id}
                to={`/hub?rec=${r.id}`}
                className="group flex flex-col gap-1.5 rounded-lg bg-white p-4 transition-all duration-200 hover:scale-[1.01]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${URGENCY_CLS[r.urgency] ?? "bg-muted text-foreground"}`}>
                    {r.urgency}
                  </span>
                  <span className="text-sm font-bold text-foreground">{r.title}</span>
                  <span className="text-xs capitalize text-muted-foreground">{r.category.replace(/_/g, " ")}</span>
                  <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1" />
                </div>
                {r.executive_summary && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{r.executive_summary}</p>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">No recommendations awaiting review.</p>
        )}
      </div>

      {/* Metric cards — every number from real records; 0 when empty */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Headcount" value={d.cards.headcount} tone="primary" sub={isTeam ? "team" : "org"} />
        <StatCard label="Open requisitions" value={d.cards.open_requisitions} tone="secondary" />
        <StatCard label="Active candidates" value={d.cards.active_candidates} tone="accent" sub="in pipeline" />
        <StatCard
          label="Onboarding journeys"
          value={d.cards.journeys_in_progress}
          tone="dark"
          sub={d.cards.journeys_in_progress > 0 ? `${d.cards.journeys_on_track} on track · ${d.cards.journeys_blocked} blocked` : undefined}
        />
        <StatCard
          label="Review priority cases"
          value={d.cards.review_priority_cases}
          tone={d.cards.review_priority_cases > 0 ? "danger" : "muted"}
          sub={`index ≥ ${d.threshold}/100`}
        />
        <StatCard label="Pending recommendations" value={d.cards.pending_recommendations} tone="accent" />
      </div>

      {/* Org-wide Skill Gap Heatmap — future-skills readiness across the workforce */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
          <TrendingUp className="h-5 w-5 text-primary" strokeWidth={2.5} />
          Future-skill readiness — org-wide gap heatmap
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase-1 Gap classifications aggregated across every {isTeam ? "team member" : "employee"} against
          each requisition's 12–24 month skills. Zeroes are real zeroes.
        </p>
        {d.heatmap.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg bg-white p-2">
            <table className="w-full min-w-[520px] border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Future skill</th>
                  <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Target role</th>
                  <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Required</th>
                  <th className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">Org gap</th>
                </tr>
              </thead>
              <tbody>
                {d.heatmap.map((h) => {
                  const pct = h.total > 0 ? h.gap_count / h.total : 0;
                  return (
                    <tr key={`${h.req_id}-${h.skill}`}>
                      <td className="px-3 py-2 text-sm font-semibold text-foreground">{h.skill}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{h.req_title}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{h.target_proficiency}/5</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-block min-w-[92px] rounded-md px-3 py-1 text-right text-sm font-bold ${heatColor(pct)}`}>
                          {h.gap_count}/{h.total}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">No future-skill data yet.</p>
        )}
      </div>

      <p className="flex items-center gap-2 rounded-lg bg-muted p-4 text-xs text-muted-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Scope ({isTeam ? "your team" : "org-wide"}) is enforced server-side — a manager request can never widen to the full org.
      </p>
    </div>
  );
}
