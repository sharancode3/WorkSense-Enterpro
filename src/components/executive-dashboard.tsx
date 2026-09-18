import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Briefcase,
  Clock,
  Filter,
  Info,
  Layers,
  ListChecks,
  Loader2,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { fetchDashboard, type DashboardData, type DashboardFilters, type HeatmapBucket } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { can } from "@/lib/rbac";

const URGENCY_CLS: Record<string, string> = {
  critical: "bg-destructive text-white",
  high: "bg-destructive text-white",
  medium: "bg-accent text-foreground",
  low: "bg-muted text-foreground",
};

// Semantic status tones — every state carries a label AND a color, never color alone.
const HEATMAP_BUCKET_META: Record<keyof HeatmapBucket["buckets"], { label: string; cls: string; hint: string }> = {
  missing: { label: "Missing", cls: "bg-destructive text-white", hint: "No verified path and no claims" },
  below_target: { label: "Below target", cls: "bg-accent text-foreground", hint: "Verified direct match under the target bar" },
  adjacent_support: { label: "Adjacent support", cls: "bg-primary text-white", hint: "Adjacent/transferable path only" },
  insufficient_evidence: { label: "Insufficient evidence", cls: "bg-muted text-foreground", hint: "Claims exist but nothing verified" },
  ready: { label: "Ready", cls: "bg-secondary text-white", hint: "Verified direct match at/above target" },
};

const BUCKET_ORDER: (keyof HeatmapBucket["buckets"])[] = ["missing", "below_target", "adjacent_support", "insufficient_evidence", "ready"];

function StatCard({
  label,
  value,
  tone,
  sub,
  definition,
  to,
}: {
  label: string;
  value: number | string;
  tone: "primary" | "secondary" | "accent" | "muted" | "dark" | "danger";
  sub?: string;
  definition: string;
  to?: string;
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
  const inner = (
    <div className={`flex h-full flex-col justify-between gap-2 rounded-lg p-3.5 transition-all duration-200 hover:scale-[1.02] ${cls}`}>
      <span className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${light ? "text-foreground/60" : "text-white/75"}`}>
        {label}
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div>
        <span className="text-2xl font-extrabold tracking-tight">{value}</span>
        {sub && <span className={`ml-2 text-xs font-semibold ${light ? "text-muted-foreground" : "text-white/70"}`}>{sub}</span>}
      </div>
      <span className={`text-[11px] leading-snug ${light ? "text-foreground/55" : "text-white/65"}`} title={definition}>
        {definition}
      </span>
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full" aria-label={`${label}: ${value} — view underlying records`}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

function monthsBetween(start: string | null, end: string | null): string[] {
  if (!start || !end || start > end) return [];
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey] = end.split("-").map(Number);
  const em = end.split("-").map(Number)[1];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function ExecutiveDashboard() {
  const { role, user } = useAuth();
  const [filters, setFilters] = useState<DashboardFilters>({});
  const dash = useQuery({
    queryKey: ["dashboard", user?.id ?? "anon", role, filters],
    queryFn: () => fetchDashboard(filters),
    staleTime: 30_000,
  });

  const months = useMemo(() => monthsBetween(dash.data?.observation_range?.start ?? null, dash.data?.observation_range?.end ?? null), [dash.data?.observation_range?.start, dash.data?.observation_range?.end]);

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
  const filtersDirty = !!(d.filters.applied.department || d.filters.applied.requisition_id || d.filters.applied.period);

  const heatSum = (h: HeatmapBucket) => BUCKET_ORDER.reduce((s, k) => s + h.buckets[k], 0);

  return (
    <div className="flex flex-col gap-10">
      {/* Toolbar: scope + definition + filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <h2 className="text-lg font-extrabold tracking-tight text-foreground">Workforce overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scope: <span className="font-bold capitalize">{isTeam ? "your team (incl. you)" : "entire organization"}</span> — enforced
            server-side from your role. Filters can only narrow it.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Dashboard filters">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            Department
            <select
              value={d.filters.applied.department ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value || null }))}
              className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All</option>
              {d.filters.available.departments.map((dep) => (
                <option key={dep} value={dep}>
                  {dep}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            Requisition
            <select
              value={d.filters.applied.requisition_id ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, requisition_id: e.target.value || null }))}
              className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All open</option>
              {d.filters.available.requisitions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({r.status})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            Review period
            <select
              value={d.filters.applied.period ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value || null }))}
              className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All observations</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          {filtersDirty && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="flex h-9 items-center gap-1 rounded-md bg-muted px-3 text-xs font-bold text-foreground transition-colors hover:bg-border"
            >
              <Filter className="h-3.5 w-3.5" /> Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Metric cards — every number from real records; 0 when empty */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Headcount"
          value={d.cards.headcount}
          tone="primary"
          sub={isTeam ? "team" : "org"}
          definition={d.definitions.headcount}
          to={can(role, "view_all_workforce") || can(role, "view_team") || role === "employee" ? "/workforce" : undefined}
        />
        {can(role, "manage_recruitment") && (
          <>
            <StatCard
              label="Open requisitions"
              value={d.cards.open_requisitions}
              tone="muted"
              sub={`on hold ${d.cards.requisition_statuses.on_hold ?? 0} · filled ${d.cards.requisition_statuses.filled ?? 0} · closed ${d.cards.requisition_statuses.closed ?? 0}`}
              definition={d.definitions.open_requisitions}
              to="/recruitment"
            />
            <StatCard
              label="Active candidates"
              value={d.cards.active_candidates}
              tone="dark"
              sub="in pipeline on open reqs"
              definition={d.definitions.active_candidates}
              to="/recruitment"
            />
          </>
        )}
        <StatCard
          label="Onboarding journeys"
          value={d.cards.journeys_in_progress}
          tone="dark"
          sub={d.cards.journeys_in_progress > 0 ? `${d.cards.journeys_on_track} on track · ${d.cards.journeys_blocked} blocked` : undefined}
          definition="Workers in scope with an active adaptive onboarding plan; blocked means a plan task is in state blocked or failed."
          to={can(role, "view_onboarding") ? "/onboarding" : undefined}
        />
        <StatCard
          label="Review priority cases"
          value={d.cards.review_priority_cases}
          tone={d.cards.review_priority_cases > 0 ? "danger" : "muted"}
          sub={`index ≥ ${d.threshold}/100`}
          definition="Workers in scope whose Workforce Review Index is at/above the threshold — decision support, not a probability."
          to={can(role, "view_all_workforce") || can(role, "view_team") ? "/workforce" : undefined}
        />
        <StatCard
          label="Pending recommendations"
          value={d.cards.pending_recommendations}
          tone="muted"
          definition="Recommendations in scope awaiting human review (status needs_review)."
          to={can(role, "approve_recommendations") ? "/hub" : undefined}
        />
      </div>

      {d.recommendations.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
              <Layers className="h-5 w-5 text-secondary" strokeWidth={2.5} /> Next actions to review
            </h2>
            {can(role, "approve_recommendations") && (
              <Link to="/hub" className="flex items-center gap-1 text-sm font-semibold text-primary">
                Open Hub <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {d.recommendations.map((r) => (
              <Link
                key={r.id}
                to={can(role, "approve_recommendations") ? `/hub?rec=${r.id}` : "#"}
                onClick={(e) => !can(role, "approve_recommendations") && e.preventDefault()}
                className="group flex flex-col gap-1.5 rounded-lg bg-white p-4 transition-all duration-200 hover:scale-[1.01]"
                aria-label={can(role, "approve_recommendations") ? `Review ${r.title}` : `${r.title} — pending review`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${URGENCY_CLS[r.urgency] ?? "bg-muted text-foreground"}`}>
                    {r.urgency}
                  </span>
                  <span className="text-sm font-bold text-foreground">{r.title}</span>
                  <span className="text-xs capitalize text-muted-foreground">{r.category.replace(/_/g, " ")}</span>
                  <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1" />
                </div>
                {r.executive_summary && <p className="line-clamp-2 text-sm text-muted-foreground">{r.executive_summary}</p>}
              </Link>
            ))}
          </div>
        </div>
      )}
      {/* Phase 14: exceptions & next actions directly beneath the KPIs — the
          first-screen answer to "what should I do next". */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          to={can(role, "view_all_workforce") || can(role, "view_team") ? "/workforce" : "#"}
          onClick={(e) => !(can(role, "view_all_workforce") || can(role, "view_team")) && e.preventDefault()}
          className="rounded-lg bg-white p-4 transition-all hover:scale-[1.01]"
          aria-label={`Review-priority cases: ${d.cards.review_priority_cases}`}
        >
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Review cases needing attention
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{d.cards.review_priority_cases}</p>
          <p className="text-[11px] text-muted-foreground">index ≥ {d.threshold}/100 · of {d.review_band_counts.total} in scope</p>
        </Link>
        <Link
          to={can(role, "view_onboarding") ? "/onboarding" : "#"}
          onClick={(e) => !can(role, "view_onboarding") && e.preventDefault()}
          className="rounded-lg bg-white p-4 transition-all hover:scale-[1.01]"
          aria-label={`Blocked onboarding journeys: ${d.cards.journeys_blocked}`}
        >
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5 text-destructive" /> Blocked onboarding journeys
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{d.cards.journeys_blocked}</p>
          <p className="text-[11px] text-muted-foreground">of {d.cards.journeys_in_progress} active — a task is blocked or failed</p>
        </Link>
        <Link
          to={can(role, "approve_recommendations") ? "/hub" : "#"}
          onClick={(e) => !can(role, "approve_recommendations") && e.preventDefault()}
          className="rounded-lg bg-white p-4 transition-all hover:scale-[1.01]"
          aria-label={`Recommendations awaiting review: ${d.cards.pending_recommendations}`}
        >
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Layers className="h-3.5 w-3.5 text-primary" /> Recommendations awaiting review
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{d.cards.pending_recommendations}</p>
          <p className="text-[11px] text-muted-foreground">each needs a typed human decision</p>
        </Link>
      </div>

      {/* Freshness + scope + filter disclosure */}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Computed {new Date(d.computed_at).toLocaleTimeString()} · period: {d.period.label}
        </span>
        {filtersDirty && (
          <span className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            Filters applied: {d.filters.applied.department ?? "all departments"} ·{" "}
            {d.filters.available.requisitions.find((r) => r.id === d.filters.applied.requisition_id)?.title ?? "all requisitions"} ·{" "}
            {d.filters.applied.period ?? "all months"}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Scope is enforced server-side — a manager request can never widen to the full org.
        </span>
      </p>

      {d.cards.journeys_in_progress > 0 && (
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
            <ListChecks className="h-5 w-5 text-secondary" strokeWidth={2.5} />
            Onboarding progress
          </h2>
          <div className="mt-4 rounded-lg bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="font-bold text-foreground">Active journeys in scope</p>
              <p className="text-muted-foreground">
                {d.cards.journeys_on_track} on track · {d.cards.journeys_blocked} blocked
              </p>
            </div>
            <div className="mt-2 flex h-4 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-secondary" style={{ width: `${(d.cards.journeys_on_track / Math.max(1, d.cards.journeys_in_progress)) * 100}%` }} />
              <div className="h-full bg-destructive" style={{ width: `${(d.cards.journeys_blocked / Math.max(1, d.cards.journeys_in_progress)) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              <b className="text-secondary">On track</b> vs <b className="text-destructive">blocked</b> — blocked journeys need an authorized resolution.
            </p>
          </div>
        </div>
      )}

      {/* Phase 14: hiring funnel (stage aging) + review bands — compact, with denominators */}
      {(d.hiring_funnel ?? []).length > 0 && (
        <div className="rounded-lg bg-white p-5">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
            <Briefcase className="h-5 w-5 text-primary" strokeWidth={2.5} /> Hiring funnel
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Applicants on open requisitions by stage in scope (n = {d.hiring_funnel.reduce((a, b) => a + b.count, 0)}). Click a stage to open the recruitment workspace.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(d.hiring_funnel ?? []).map((st) => (
              <Link
                key={st.stage}
                to="/recruitment"
                className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 transition-all hover:scale-[1.02]"
                aria-label={`${st.stage}: ${st.count} applicants`}
              >
                <span className="text-sm font-bold capitalize text-foreground">{st.stage.replace(/_/g, " ")}</span>
                <span className="text-lg font-extrabold text-primary">{st.count}</span>
              </Link>
            ))}
          </div>
          <h3 className="mt-5 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
            Review bands (in scope, n = {d.review_band_counts?.total ?? 0})
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ["Review (75+)", d.review_band_counts?.review ?? 0, "bg-destructive text-white"],
              ["High (60-74)", d.review_band_counts?.high ?? 0, "bg-destructive/80 text-white"],
              ["Medium (40-59)", d.review_band_counts?.medium ?? 0, "bg-accent text-foreground"],
              ["Low (0-39)", d.review_band_counts?.low ?? 0, "bg-muted text-foreground"],
            ].map(([label, count, cls]) => (
              <span key={String(label)} className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm">
                <span className="font-bold capitalize text-foreground">{label}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${cls}`}>{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Future-skill readiness heatmap with explicit buckets */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
          <TrendingUp className="h-5 w-5 text-primary" strokeWidth={2.5} />
          Future-skill readiness — {isTeam ? "team" : "org"} heatmap
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{d.definitions.heatmap}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" /> Legend
          </span>
          {BUCKET_ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-3 w-3 rounded-sm ${HEATMAP_BUCKET_META[k].cls}`} aria-hidden="true" />
              {HEATMAP_BUCKET_META[k].label}
            </span>
          ))}
        </div>

        {d.heatmap.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg bg-white p-2">
            <table className="w-full min-w-[720px] border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Future skill</th>
                  <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Target role</th>
                  <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Bar</th>
                  {BUCKET_ORDER.map((k) => (
                    <th key={k} className="px-3 py-2 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {HEATMAP_BUCKET_META[k].label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">In scope</th>
                </tr>
              </thead>
              <tbody>
                {d.heatmap.map((h) => (
                  <tr key={`${h.req_id}-${h.skill}`} className="align-top">
                    <td className="px-3 py-2 text-sm font-semibold text-foreground">{h.skill}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{h.req_title}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{h.target_proficiency}/5</td>
                    {BUCKET_ORDER.map((k) => (
                      <td key={k} className="px-3 py-2 text-center">
                        <span
                          title={HEATMAP_BUCKET_META[k].hint}
                          className={`inline-block min-w-[44px] rounded-md px-2.5 py-1 text-sm font-bold ${h.buckets[k] > 0 ? HEATMAP_BUCKET_META[k].cls : "bg-muted/60 text-muted-foreground/50"}`}
                        >
                          {h.buckets[k]}
                        </span>
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center text-sm font-semibold text-muted-foreground">{heatSum(h)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-muted p-6 text-sm text-muted-foreground">
            {filtersDirty
              ? "No future-skill data matches the selected filters (no open requisitions in scope)."
              : "No open requisitions with future skills in scope yet."}
          </div>
        )}
      </div>
    </div>
  );
}
