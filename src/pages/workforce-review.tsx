import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ClipboardList,
  Eye,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/contexts/auth-context";
import { can } from "@/lib/rbac";
import {
  fetchDashboard,
  fetchWorkforceReview,
  fetchPerformanceSummary,
  type ReviewCaseRow,
  type WorkforceReviewResult,
  type PerformanceSummaryResult,
} from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";

const PRIORITY_CLS: Record<string, string> = {
  review: "bg-destructive text-white",
  high: "bg-destructive/80 text-white",
  medium: "bg-accent text-foreground",
  low: "bg-muted text-foreground",
};

const FACTOR_LABEL: Record<string, string> = {
  career: "Career in band",
  attendance: "Attendance pattern",
  delivery: "Delivery load",
  engagement: "Engagement trend",
};

function FactorBar({ name, factor }: { name: string; factor: { score: number; weight: number; definition: string; source_period: string | null; note: string | null } }) {
  return (
    <div className="rounded-lg bg-muted p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">{FACTOR_LABEL[name] ?? name}</span>
        <span className="text-xs font-bold text-muted-foreground">
          {(factor.score * 100).toFixed(0)}/100 · weight {Math.round(factor.weight * 100)}%
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full bg-primary" style={{ width: `${Math.round(factor.score * 100)}%` }} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{factor.definition}</p>
      {factor.source_period && <p className="mt-1 text-[11px] font-semibold text-primary">Source period: {factor.source_period}</p>}
      {factor.note && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-accent/60 p-2 text-[11px] leading-relaxed text-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {factor.note}
        </p>
      )}
    </div>
  );
}

function TrendRow({ t }: { t: { metric: string; direction: string; delta: number | null; first: number | null; last: number | null; periods: string[] } }) {
  const up = t.direction === "up";
  const down = t.direction === "down";
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-2.5">
      <span className="text-sm font-semibold capitalize text-foreground">{t.metric}</span>
      <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
        {t.direction === "insufficient" ? (
          <span className="text-muted-foreground">insufficient data</span>
        ) : (
          <>
            {up ? <TrendingUp className="h-3.5 w-3.5 text-destructive" /> : down ? <TrendingDown className="h-3.5 w-3.5 text-primary" /> : <Activity className="h-3.5 w-3.5 text-muted-foreground" />}
            {up ? "rising" : down ? "declining" : "flat"}
            {t.delta !== null ? ` (${(t.delta * 100).toFixed(0)}%)` : ""}
          </>
        )}
      </span>
    </div>
  );
}

export default function WorkforceReview() {
  const { role, twin: me } = useAuth();
  const isEmployee = role === "employee";

  const dash = useQuery({
    queryKey: ["dashboard", me?.id ?? "anon", role],
    queryFn: fetchDashboard,
  });

  const cases: ReviewCaseRow[] = useMemo(() => {
    if (isEmployee || !me) return [];
    return dash.data?.review_cases ?? [];
  }, [dash.data, isEmployee, me]);

  // Phase 32: search + department + risk filters for the case list.
  const [q, setQ] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const members = useQuery({
    queryKey: ["wr-members", me?.id ?? "anon"],
    enabled: !isEmployee && !!me,
    queryFn: async () => {
      const { data } = await supabase.from("digital_twins").select("id, department");
      return new Map((data ?? []).map((t) => [t.id, t.department ?? "—"]));
    },
  });
  const riskBucket = (index: number) => (index >= 71 ? "high" : index >= 31 ? "medium" : "low");
  const filteredCases = useMemo(() => {
    const text = q.trim().toLowerCase();
    return cases.filter((c) => {
      if (text && !c.name.toLowerCase().includes(text)) return false;
      if (deptFilter !== "all" && (members.data?.get(c.twin_id) ?? "—") !== deptFilter) return false;
      if (riskFilter !== "all" && riskBucket(c.index) !== riskFilter) return false;
      return true;
    });
  }, [cases, q, deptFilter, riskFilter, members.data]);
  const departments = useMemo(() => {
    const seen = new Set<string>();
    for (const c of cases) seen.add(members.data?.get(c.twin_id) ?? "—");
    return [...seen].sort();
  }, [cases, members.data]);

  // Employees review only their own case; managers/HR get the scoped list.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [perfForce, setPerfForce] = useState(false);
  const activeId = isEmployee ? (me?.id ?? null) : selectedId ?? cases[0]?.twin_id ?? null;

  const caseQuery = useQuery({
    queryKey: ["review-case", me?.id ?? "anon", activeId],
    enabled: !!activeId && (!!isEmployee || !!selectedId || cases.length > 0),
    queryFn: () => fetchWorkforceReview(activeId!),
  });

  const perfQuery = useQuery({
    queryKey: ["perf-summary", me?.id ?? "anon", activeId, perfForce],
    enabled: !!activeId,
    queryFn: () => fetchPerformanceSummary(activeId!, perfForce),
  });

  const recsQuery = useQuery({
    queryKey: ["review-recs", me?.id ?? "anon", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      if (!activeId) return [];
      const { data } = await supabase
        .from("recommendations")
        .select("id, category, urgency, status, proposed_action, executive_summary, created_at")
        .eq("twin_id", activeId)
        .order("created_at", { ascending: false });
      return (data ?? []) as { id: string; category: string; urgency: string; status: string; proposed_action: { title?: string } | null; executive_summary: string; created_at: string }[];
    },
  });

  if (!role || !me) return null;
  if (!can(role, "view_all_workforce") && !can(role, "view_team") && role !== "employee") {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <div className="flex items-center gap-3 rounded-lg bg-destructive/10 p-6 text-sm text-destructive">
            <ShieldAlert className="h-5 w-5" /> Workforce review data is restricted to HR, managers and the employee themselves.
          </div>
        </div>
      </AppShell>
    );
  }

  const detail: WorkforceReviewResult | undefined = caseQuery.data;
  const perf: PerformanceSummaryResult | undefined = perfQuery.data;
  const selected = cases.find((c) => c.twin_id === activeId);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Workforce Review</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">Longitudinal review cases</h1>
          <p className="max-w-3xl text-muted-foreground">
            The Workforce Review Index (0–100) is interpretable decision support: it flags when a review conversation is
            warranted, with the contributing factors, trend, data completeness and recommended fact-finding shown.{" "}
            <span className="font-bold text-foreground">It is not a probability of leaving</span>, and missing data or
            development interest are never treated as risk.
          </p>
        </div>

        {/* List (HR / manager) */}
        {!isEmployee && (
          <div className="mt-8 overflow-hidden rounded-lg bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
              <label className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search employee name…"
                  className="w-44 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  aria-label="Search employees"
                />
              </label>
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                aria-label="Filter by department"
                className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
              >
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                aria-label="Filter by risk level"
                className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
              >
                <option value="all">All risk levels</option>
                <option value="high">High risk (71-100)</option>
                <option value="medium">Moderate (31-70)</option>
                <option value="low">Low (0-30)</option>
              </select>
              <span className="ml-auto text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {dash.data?.scope === "team" ? "Your team" : "Org-wide"} · {filteredCases.length} of {cases.length} employees
              </span>
            </div>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {filteredCases.map((c) => {
                const bucket = riskBucket(c.index);
                const gaugeCls = bucket === "high" ? "bg-destructive" : bucket === "medium" ? "bg-accent" : "bg-secondary";
                const dept = members.data?.get(c.twin_id) ?? "—";
                return (
                  <li key={c.twin_id}>
                    <button
                      onClick={() => setSelectedId(c.twin_id)}
                      className={`flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-muted ${activeId === c.twin_id ? "bg-muted" : ""}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{dept} · Completeness {Math.round(c.completeness * 100)}%</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {c.seeking_growth && (
                          <span className="flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                            <Sparkles className="h-3 w-3" /> growth interest
                          </span>
                        )}
                        <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${PRIORITY_CLS[c.priority] ?? "bg-muted text-foreground"}`}>
                          {c.priority}
                        </span>
                        <div className="flex w-24 items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <span className={`block h-full ${gaugeCls}`} style={{ width: `${c.index}%` }} />
                          </span>
                          <span className="w-12 text-right text-sm font-extrabold text-foreground">{c.index}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
              {filteredCases.length === 0 && (
                <li className="px-5 py-4 text-sm text-muted-foreground">No employees match the current filters.</li>
              )}
            </ul>
          </div>
        )}

        {/* Detail */}
        <div className="mt-8 flex flex-col gap-6">
          {caseQuery.isLoading || (isEmployee && !caseQuery.data) ? (
            <div className="flex items-center gap-3 rounded-lg bg-muted p-8 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" /> Computing the review case…
            </div>
          ) : caseQuery.error || !detail ? (
            <div className="rounded-lg bg-destructive/10 p-6 text-sm text-destructive">
              Review case unavailable: {caseQuery.error instanceof Error ? caseQuery.error.message : "unknown error"}
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="rounded-lg bg-foreground p-6 text-white">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-white/60">Workforce Review Index</p>
                    <p className="mt-1 text-4xl font-extrabold tracking-tight">{detail.index}/100</p>
                    <span className={`mt-2 inline-block rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${PRIORITY_CLS[detail.priority] ?? "bg-muted text-foreground"}`}>
                      Review priority: {detail.priority}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-sm text-white/80">
                    <span>Data completeness: {Math.round(detail.data_completeness * 100)}%</span>
                    {detail.seeking_growth && (
                      <span className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-bold text-white">
                        <Sparkles className="h-3.5 w-3.5" /> Reports development interest — a growth conversation, not risk
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-4 flex items-start gap-2 rounded-md bg-white/10 p-3 text-xs leading-relaxed text-white/85">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  This index is interpretable decision support, not a probability of leaving. Missing observations are data
                  gaps (shown below), never poor performance.
                </p>
              </div>

              {/* Factors */}
              <div>
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                  <BarChart3 className="h-5 w-5 text-primary" strokeWidth={2.5} /> Contributing factors
                </h2>
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {Object.entries(detail.factors).map(([name, f]) => (
                    <FactorBar key={name} name={name} factor={f} />
                  ))}
                </div>
              </div>

              {/* Trend + missing data */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
                    <TrendingUp className="h-4 w-4" /> Trend (last 6 months)
                  </h3>
                  <div className="mt-3 flex flex-col gap-2">
                    {detail.trend.map((t) => (
                      <TrendRow key={t.metric} t={t} />
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
                    <Eye className="h-4 w-4" /> Missing data & completeness
                  </h3>
                  <p className="mt-3 rounded-lg bg-muted p-4 text-sm text-foreground">
                    {Math.round(detail.data_completeness * 100)}% of expected observation slots are present. Missing
                    periods never count as poor performance.
                  </p>
                  {detail.missing_data.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {detail.missing_data.map((m) => (
                        <li key={m.metric} className="flex items-center justify-between rounded-md bg-muted px-4 py-2 text-sm">
                          <span className="font-semibold capitalize text-foreground">{m.metric}</span>
                          <span className="text-xs text-muted-foreground">{m.periods.length} period(s) missing</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 rounded-md bg-muted px-4 py-2 text-sm text-muted-foreground">No missing periods recorded.</p>
                  )}
                </div>
              </div>

              {/* Action support (non-punitive) */}
              <div>
                <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
                  <ClipboardList className="h-4 w-4" /> Recommended fact-finding (non-punitive)
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {detail.recommended_fact_finding.map((f, i) => (
                    <p key={i} className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm leading-relaxed text-foreground">
                      <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {f}
                    </p>
                  ))}
                  {detail.recommended_fact_finding.length === 0 && (
                    <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">No specific follow-up suggested — the case looks clean.</p>
                  )}
                </div>
              </div>

              {/* Alternative explanations / limitations */}
              <div className="rounded-lg bg-accent/50 p-5">
                <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-foreground">
                  <Info className="h-4 w-4" /> Alternative explanations & limitations
                </h3>
                {detail.priority_gate?.tier_capped && detail.priority_gate.reason && (
                  <p className="mt-2 rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">{detail.priority_gate.reason}</p>
                )}
                <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-xs leading-relaxed text-foreground/80">
                  {detail.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>

              {/* Performance intelligence */}
              <div className="rounded-lg bg-white p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                    <FileText className="h-5 w-5 text-secondary" strokeWidth={2.5} /> Performance summary
                  </h2>
                  <button
                    onClick={() => {
                      setPerfForce(true);
                      perfQuery.refetch();
                    }}
                    disabled={perfQuery.isFetching}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${perfQuery.isFetching ? "animate-spin" : ""}`} /> Regenerate
                  </button>
                </div>
                {perfQuery.isLoading ? (
                  <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" /> Synthesizing from source facts…
                  </p>
                ) : perfQuery.error || !perf ? (
                  <p className="mt-4 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
                    Performance summary unavailable: {perfQuery.error instanceof Error ? perfQuery.error.message : "unknown"}
                  </p>
                ) : !perf.summary ? (
                  <p className="mt-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                    No performance summary synthesized for this employee yet. Click "Regenerate" above to synthesize.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-col gap-5">
                    {perf.cached && <p className="text-xs font-semibold text-muted-foreground">Cached from the same source version — regenerated only when underlying records change.</p>}
                    <p className="rounded-lg bg-muted p-4 text-sm leading-relaxed text-foreground">{perf.summary?.narrative ?? "No narrative available."}</p>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Source facts (cited)</h4>
                        <ul className="mt-2 flex max-h-56 list-none flex-col gap-1.5 overflow-y-auto">
                          {(perf.facts?.source_facts ?? []).map((sf) => (
                            <li key={sf.ref} className="rounded-md bg-muted p-2.5 text-xs leading-relaxed text-foreground">
                              <span className="font-bold text-primary">[{sf.ref}]</span> <span className="font-semibold">{sf.source}</span> — {sf.fact}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Contradictions & sparse evidence</h4>
                        <ul className="mt-2 flex flex-col gap-2">
                          {(perf.summary?.contradictions ?? []).map((c, i) => (
                            <li key={i} className="rounded-md bg-accent/60 p-3 text-xs leading-relaxed text-foreground">
                              <span className="font-bold">{c.title}.</span> {c.evidence.join(" ")}
                            </li>
                          ))}
                          {(perf.summary?.contradictions ?? []).length === 0 && <li className="rounded-md bg-muted p-3 text-xs text-muted-foreground">No contradictory records found.</li>}
                          {(perf.summary?.sparse_evidence?.flags ?? []).map((f, i) => (
                            <li key={i} className="flex items-start gap-1.5 rounded-md bg-muted p-3 text-xs text-foreground">
                              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Inferred themes (labeled inference)</h4>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {(perf.summary?.inferred_themes ?? []).map((t, i) => (
                          <li key={i} className="rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">
                            <span className="font-bold">{t.theme}.</span> {t.basis.join(" · ")} <span className="italic text-muted-foreground">{t.confidence_note ?? ""}</span>
                          </li>
                        ))}
                        {(perf.summary?.inferred_themes ?? []).length === 0 && <li className="text-xs text-muted-foreground">None inferred.</li>}
                      </ul>
                    </div>

                    <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs italic leading-relaxed text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {perf.summary?.model_note ?? ""}
                    </p>
                  </div>
                )}
              </div>

              {/* Reviewed follow-up */}
              <div>
                <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
                  <Users className="h-4 w-4" /> Reviewed follow-up
                </h3>
                <div className="mt-3 flex flex-col gap-2">
                  {recsQuery.data && recsQuery.data.length > 0 ? (
                    recsQuery.data.map((r) => (
                      <Link key={r.id} to={`/hub?rec=${r.id}`} className="group flex items-center justify-between gap-3 rounded-lg bg-white p-4 transition-all hover:scale-[1.01]">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{r.proposed_action?.title ?? r.category}</p>
                          <p className="line-clamp-1 text-xs text-muted-foreground">{r.executive_summary}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">{r.status}</span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                        </div>
                      </Link>
                    ))
                  ) : (
                    <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                      No recommendations or actions on record yet — the case below documents where the evidence stands today.
                    </p>
                  )}
                  {selected && (
                    <p className="rounded-lg bg-muted p-4 text-xs text-muted-foreground">
                      Case computed at seed for review period with {Math.round(selected.completeness * 100)}% observation completeness.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
