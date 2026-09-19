import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Info,
  Loader2,
  Lock,
  Search,
  Share2,
  ShieldCheck,
  Target,
  Workflow,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { FitCard } from "@/components/fit-card";
import {
  computeSkillFit,
  coverageBreakdown,
  developmentForecast,
  futureRequirementDiff,
  type FitClassification,
  type FitLineage,
  type FitRecord,
  type GraphNode,
  type SkillMatchResult,
} from "@/lib/skill-graph";
import { can } from "@/lib/rbac";
import { Button } from "@/components/ui/button";

interface TwinOption {
  id: string;
  name: string;
  role: string;
  department: string | null;
  manager_id: string | null;
}

const STATE_META: Record<string, { label: string; chip: string }> = {
  reviewer_confirmed: { label: "Reviewer verified", chip: "bg-primary text-white" },
  assessment_supported: { label: "Assessment supported", chip: "bg-secondary text-white" },
  extracted: { label: "Extracted (unverified)", chip: "bg-muted text-foreground" },
  claimed: { label: "Self-reported", chip: "bg-muted text-foreground" },
  expired: { label: "Expired", chip: "bg-muted text-muted-foreground" },
  disputed: { label: "Disputed", chip: "bg-muted text-muted-foreground" },
  superseded: { label: "Superseded", chip: "bg-muted text-muted-foreground" },
};

const EDGE_LIMITATION: Record<string, string> = {
  ADJACENT_TO: "Related but not equivalent — capability in the required skill is not yet evidenced.",
  TRANSFERABLE_TO: "Transferable signal only — establishes no proficiency and earns no points.",
  PREREQUISITE_OF: "Prerequisite relationship — the target typically builds on this skill.",
};

const EDGE_LEGEND: Record<string, { label: string; color: string; dashed?: boolean }> = {
  ADJACENT_TO: { label: "Related skill", color: "var(--secondary, #0ea5a4)" },
  TRANSFERABLE_TO: { label: "Transferable experience", color: "var(--accent, #f59e0b)", dashed: true },
  PREREQUISITE_OF: { label: "Prerequisite", color: "var(--primary, #6d5efc)" },
};

const CLASS_META: Record<FitClassification, { label: string; color: string; hint: string }> = {
  verified_direct: { label: "Verified direct", color: "var(--secondary, #0ea5a4)", hint: "Accepted evidence, at/above target" },
  provisional_direct: { label: "Provisional direct", color: "var(--primary, #6d5efc)", hint: "Claimed/extracted, not accepted" },
  below_target: { label: "Below target", color: "var(--accent, #f59e0b)", hint: "Direct evidence below the bar" },
  adjacent_support: { label: "Adjacent support", color: "var(--secondary, #0ea5a4)", hint: "Related but not equivalent" },
  transferable_foundation: { label: "Transferable foundation", color: "var(--primary, #6d5efc)", hint: "Development candidate, no points" },
  missing: { label: "Missing", color: "var(--destructive, #ef4444)", hint: "No evidence or path" },
};

const EDGE_HUMAN: Record<string, string> = {
  ADJACENT_TO: "related skill",
  TRANSFERABLE_TO: "transferable experience",
  PREREQUISITE_OF: "prerequisite",
};

// Results are BOUND to the person + demand they were computed for. Changing
// either marks them outdated; late responses are ignored.
interface MatchResults {
  twinId: string;
  reqId: string;
  current: FitRecord;
  future: FitRecord | null;
  futureUndefined: boolean;
  lineage: FitLineage | null;
  artifacts: { artifact_keys: string[]; count: number } | null;
  scope: SkillMatchResult["scope"] | null;
  cached: boolean;
  computedAt: string;
}

export default function SkillGraph() {
  const { role, twin: me, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [twinId, setTwinId] = useState(() => searchParams.get("person") ?? "");
  const [reqId, setReqId] = useState(() => searchParams.get("demand") ?? "");
  const [results, setResults] = useState<MatchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxSearch, setTaxSearch] = useState("");
  const [focusedSkill, setFocusedSkill] = useState<string | null>(null);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [matrixScenario, setMatrixScenario] = useState<"current" | "future">("current");
  const [matrixFilter, setMatrixFilter] = useState<"all" | FitClassification>("all");
  // Monotonic run id: a completed request only commits its results when it is
  // still the latest run (late previous-selection responses are dropped).
  const runIdRef = useRef(0);

  const twins = useQuery({
    queryKey: ["graph-twins", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("digital_twins")
        .select("id, name, role, department, manager_id")
        .order("name");
      return (data ?? []) as TwinOption[];
    },
  });

  const reqs = useQuery({
    queryKey: ["graph-reqs", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_requisitions")
        .select("id, title, department, required_skills, future_skills, seniority_level, status")
        .order("title");
      return (data ?? []) as { id: string; title: string; department: string; required_skills: unknown[]; future_skills: unknown[]; seniority_level: number; status: string }[];
    },
  });

  const graph = useQuery({
    queryKey: ["graph-nodes", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase.from("skill_graph").select("id, skill, category, outgoing_edges");
      return (data ?? []) as GraphNode[];
    },
  });

  // ---- Role-scoped person list (server still enforces; this is UX) ----
  const scopedTwins = useMemo(() => {
    const all = twins.data ?? [];
    if (!me) return [];
    if (role === "employee") return all.filter((t) => t.id === me.id);
    if (role === "recruiter") return all.filter((t) => t.role === "candidate");
    if (role === "manager") {
      const children = new Map<string, string[]>();
      for (const t of all) if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
      const seen = new Set<string>();
      const stack = [me.id];
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const c of children.get(cur) ?? []) stack.push(c);
      }
      return all.filter((t) => seen.has(t.id) && (t.role === "employee" || t.role === "manager"));
    }
    return all.filter((t) => t.role === "employee" || t.role === "manager");
  }, [twins.data, role, me]);

  // ---- Searchable taxonomy + focused relationship view ----
  const categories = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const node of graph.data ?? []) {
      map.set(node.category || "Other", [...(map.get(node.category || "Other") ?? []), node]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [graph.data]);

  const filteredCategories = useMemo(() => {
    const q = taxSearch.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map(([cat, nodes]) => [cat, nodes.filter((n) => n.skill.toLowerCase().includes(q))] as [string, GraphNode[]])
      .filter(([, nodes]) => nodes.length > 0);
  }, [categories, taxSearch]);

  const reverseEdges = useMemo(() => {
    const map = new Map<string, { from: string; type: string; weight: number }[]>();
    for (const node of graph.data ?? []) {
      for (const e of node.outgoing_edges) {
        map.set(e.target_skill.toLowerCase(), [...(map.get(e.target_skill.toLowerCase()) ?? []), { from: node.skill, type: e.type, weight: e.weight }]);
      }
    }
    return map;
  }, [graph.data]);

  const focusedNode = useMemo(() => graph.data?.find((n) => n.skill === focusedSkill), [graph.data, focusedSkill]);

  const runMatch = async (force = false) => {
    if (!twinId || !reqId) return;
    const runId = ++runIdRef.current;
    const selTwin = twinId;
    const selReq = reqId;
    const reqRow = (reqs.data ?? []).find((r) => r.id === selReq);
    const hasFuture = Boolean(reqRow && Array.isArray(reqRow.future_skills) && reqRow.future_skills.length > 0);
    setBusy(true);
    setError(null);
    try {
      const [cur, fut] = await Promise.all([
        computeSkillFit({ twin_id: selTwin, target_id: selReq, scenario: "current", force }),
        hasFuture ? computeSkillFit({ twin_id: selTwin, target_id: selReq, scenario: "future", force }) : Promise.resolve(null),
      ]);
      if (runIdRef.current !== runId) return; // superseded by a newer run
      setResults({
        twinId: selTwin,
        reqId: selReq,
        current: cur.fit,
        future: fut?.fit ?? null,
        futureUndefined: !hasFuture,
        lineage: cur.lineage ?? fut?.lineage ?? null,
        artifacts: cur.evidence_artifacts ?? fut?.evidence_artifacts ?? null,
        scope: cur.scope ?? fut?.scope ?? null,
        cached: Boolean(cur.cached && fut?.cached !== false),
        computedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setError(err instanceof Error ? err.message : "Skill match failed");
    } finally {
      if (runIdRef.current === runId) setBusy(false);
    }
  };

  useEffect(() => {
    if (!twinId || !reqId) return;
    if (!reqs.data) return;
    if (results && results.twinId === twinId && results.reqId === reqId) return;
    void runMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twinId, reqId, reqs.data]);

  const futureDiff = useMemo(() => {
    const reqRow = (reqs.data ?? []).find((r) => r.id === results?.reqId);
    if (!reqRow) return null;
    const cur = (reqRow.required_skills ?? []) as { skill: string; target_proficiency: number }[];
    const fut = (reqRow.future_skills ?? []) as { skill: string; target_proficiency: number }[];
    if (fut.length === 0) return null;
    const d = futureRequirementDiff(cur, fut);
    return d.added.length > 0 || d.raised.length > 0 || d.removed.length > 0 ? d : null;
  }, [reqs.data, results?.reqId]);

  // E2: verified coverage vs profile match (claims included) over direct skills.
  const coverage = useMemo(() => {
    if (!results?.current || !results.lineage) return null;
    const c = coverageBreakdown(
      results.current.scoring.requirements.filter((i) => i.relationship === "direct"),
      results.lineage.assertions
    );
    return c.directTotal > 0 ? c : null;
  }, [results]);

  // Gaps: any requirement where the effective credit is below the bar.
  const unmet = useMemo(
    () => (results?.current ? results.current.scoring.requirements.filter((r) => r.effective_proficiency < r.required_proficiency) : []),
    [results]
  );

  // The matrix rows come from whichever scenario is being inspected.
  const matrixFit = matrixScenario === "future" && results?.future ? results.future : results?.current ?? null;
  const matrixRows = useMemo(() => {
    if (!matrixFit) return [];
    const rows = matrixFit.scoring.requirements ?? [];
    if (matrixFilter === "all") return rows;
    return rows.filter((r) => r.classification === matrixFilter);
  }, [matrixFit, matrixFilter]);

  // Phase 9: current-vs-future raw delta, shown even when rounded values are equal.
  const futureDelta = useMemo(() => {
    if (!results?.future || !results.current) return null;
    const raw = results.future.score - results.current.score;
    return { raw, rounded: Math.round(results.future.score * 100) - Math.round(results.current.score * 100) };
  }, [results]);

  if (role && !can(role, "explore_skill_graph")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Skill development requires a review scope</h1>
          <p className="text-muted-foreground">
            This view is role-scoped and enforced server-side: employees see themselves, managers see their team,
            recruiters see authorized candidates, and HR sees the organization.
          </p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const scopeLabel =
    results?.scope === "self" ? "Your own skills" : results?.scope === "team" ? "Your team" : results?.scope === "candidates" ? "Authorized candidates" : "Organization";
  const selectionDirty = Boolean(results && (results.twinId !== twinId || results.reqId !== reqId));
  const person = (twins.data ?? []).find((t) => t.id === results?.twinId);
  const reqRow = (reqs.data ?? []).find((r) => r.id === results?.reqId);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Skill Development · Evidence-based</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Capability against a chosen demand
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Pick a person and a demand to see their <b>verified evidence</b> mapped to the requirements. The headline is{" "}
            <b>verified readiness</b> (accepted independent evidence only); the provisional profile match includes
            self-reported and extracted claims, each attenuated by its evidence quality. There is no evidence-count or
            seniority component — unrelated evidence can never manufacture match points.
          </p>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Scope for this account: {scopeLabel} — enforced server-side.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Person {role === "employee" ? "(you)" : role === "manager" ? "(your team)" : role === "recruiter" ? "(candidates)" : "(org)"}
            </span>
            <select
              value={twinId}
              onChange={(e) => setTwinId(e.target.value)}
              className="h-12 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
            >
              <option value="">Select a person…</option>
              {scopedTwins.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.role.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Demand (role)</span>
            <select
              value={reqId}
              onChange={(e) => setReqId(e.target.value)}
              className="h-12 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
            >
              <option value="">Select a role…</option>
              {(reqs.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.department} {r.status === "open" ? "" : `· ${r.status}`}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <Button size="xl" className="min-w-[190px] flex-1" onClick={() => void runMatch()} disabled={busy || !twinId || !reqId}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-5 w-5" />}
              Compute coverage
            </Button>
            <Button variant="secondary" size="xl" className="min-w-[140px]" onClick={() => void runMatch(true)} disabled={busy || !twinId || !reqId}>
              Recompute
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-lg bg-destructive p-4 text-white">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {results && (
          <>
            {selectionDirty ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-accent/40 bg-accent/10 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Info className="h-4 w-4 text-accent" /> Selection changed — these results were computed for a previous
                  person or role.
                </p>
                <Button size="sm" variant="outline" onClick={() => void runMatch()} disabled={busy || !twinId || !reqId}>
                  Recompute for this selection
                </Button>
              </div>
            ) : (
              <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Computed for this selection{results.cached ? " (served from cache)" : ""} · last computed{" "}
                {new Date(results.computedAt).toLocaleString()}. Evidence, requisition, seniority, or graph changes
                invalidate the cached result automatically (version fingerprint), so Recompute is always current.
              </p>
            )}

            {/* Sticky compact assessment header */}
            <div className="sticky top-0 z-20 mt-6 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-extrabold text-foreground">{person?.name ?? "Person"}</span>
                  <span className="text-xs text-muted-foreground">{person?.role.replace("_", " ")}</span>
                  <span className="text-border">|</span>
                  <span className="font-semibold text-foreground">{results.current.target_title}</span>
                  <span className="text-xs text-muted-foreground">{reqRow?.department}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">Current {Math.round(results.current.score * 100)}%</span>
                  {results.future ? (
                    <span className="rounded-md bg-secondary/10 px-2 py-1 text-secondary">
                      Future target {Math.round(results.future.score * 100)}%
                    </span>
                  ) : (
                    <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">Future not defined</span>
                  )}
                  <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                    {results.current.scoring.resolved_from === "current" ? "current scenario" : "resolved-future"}
                  </span>
                </div>
              </div>
            </div>

            {/* Phase 9: four decision cards */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg bg-primary p-4 text-white">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/70">Verified readiness</p>
                <p className="mt-1 text-3xl font-extrabold">{Math.round(results.current.score * 100)}<span className="text-base opacity-70">/100</span></p>
                <p className="mt-1 text-[11px] text-white/75">accepted evidence vs {results.current.scoring.requirements.length} current requirement(s)</p>
              </div>
              <div className="rounded-lg bg-secondary p-4 text-white">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/70">Provisional profile match</p>
                <p className="mt-1 text-3xl font-extrabold">{Math.round(results.current.profile_match * 100)}<span className="text-base opacity-70">/100</span></p>
                <p className="mt-1 text-[11px] text-white/75">all live claims, attenuated by evidence quality</p>
              </div>
              <div className={`rounded-lg p-4 ${results.current.mandatory_gate.met ? "bg-muted text-foreground" : "bg-destructive text-white"}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wider ${results.current.mandatory_gate.met ? "text-muted-foreground" : "text-white/80"}`}>Mandatory gate</p>
                <p className={`mt-1 text-3xl font-extrabold ${results.current.mandatory_gate.met ? "text-secondary" : ""}`}>
                  {results.current.mandatory_gate.met ? "Met" : "Not met"}
                </p>
                <p className={`mt-1 text-[11px] ${results.current.mandatory_gate.met ? "text-muted-foreground" : "text-white/85"}`}>
                  {results.current.mandatory_gate.met
                    ? `${results.current.scoring.mandatory.met}/${results.current.scoring.mandatory.count} mandatory met`
                    : `unmet: ${results.current.mandatory_gate.unmet_skills.join(", ") || "—"}`}
                </p>
              </div>
              <div className="rounded-lg bg-muted p-4 text-foreground">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Evidence confidence</p>
                <p className="mt-1 text-3xl font-extrabold">{Math.round(results.current.evidence_confidence * 100)}<span className="text-base text-muted-foreground">/100</span></p>
                <p className="mt-1 text-[11px] text-muted-foreground">{results.artifacts?.count ?? 0} independent artifact(s) · mean review rigor</p>
              </div>
            </div>

            {/* Phase 9: current-vs-future comparison (three honest values) */}
            <div className="mt-6 rounded-lg border-2 border-primary/15 bg-primary/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight text-foreground">
                  <Target className="h-5 w-5 text-primary" strokeWidth={2.5} /> Current vs future target — three honest values
                </h3>
                <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ring-1 ring-border">
                  engine v{results.current.versions?.engine}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
                <div className="rounded-lg bg-foreground p-4 text-white">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Current verified readiness</p>
                  <p className="mt-1 text-2xl font-extrabold">{Math.round(results.current.score * 100)}%</p>
                  <p className="mt-0.5 text-[11px] text-white/70">
                    today's evidence vs {results.current.scoring.requirements.length} current requirement(s) · mandatory {results.current.scoring.mandatory.count}
                  </p>
                </div>
                <div className={`rounded-lg p-4 ${results.future && results.future.score < results.current.score ? "bg-accent text-foreground" : "bg-secondary text-white"}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${results.future && results.future.score < results.current.score ? "text-foreground/60" : "text-white/70"}`}>Future-target readiness today</p>
                  <p className="mt-1 text-2xl font-extrabold">
                    {results.future ? `${Math.round(results.future.score * 100)}%` : "Not defined"}
                  </p>
                  <p className={`mt-0.5 text-[11px] ${results.future && results.future.score < results.current.score ? "text-foreground/70" : "text-white/75"}`}>
                    {results.future
                      ? `today's evidence vs resolved future target (${results.future.scoring.requirements.length} requirements) — no assumed learning`
                      : "this demand defines no future requirements"}
                  </p>
                </div>
                <div className="rounded-lg bg-white p-4 ring-1 ring-border">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Development forecast</p>
                  {results.future ? (() => {
                    const f = developmentForecast(results.future, null);
                    return (
                      <>
                        <p className="mt-1 text-lg font-extrabold text-foreground">Forecast not available</p>
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{f.reason}</p>
                      </>
                    );
                  })() : (
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      Future requirements are not defined, so there is nothing to forecast against.
                    </p>
                  )}
                </div>
              </div>

              {/* Raw delta — shown even when rounded values are equal */}
              {results.future && futureDelta && (
                <div className="mt-3 rounded-lg bg-white p-3 text-xs text-foreground ring-1 ring-border">
                  <p className="font-bold">
                    Change vs today:{" "}
                    <span className={futureDelta.raw > 0 ? "text-secondary" : futureDelta.raw < 0 ? "text-destructive" : "text-foreground"}>
                      {futureDelta.raw > 0 ? "+" : ""}{futureDelta.raw.toFixed(3)} raw
                    </span>
                    {" · "}
                    <span className="text-muted-foreground">rounded {futureDelta.rounded > 0 ? "+" : ""}{futureDelta.rounded} pts</span>
                  </p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    {futureDelta.raw === 0
                      ? "The rounded values look identical but the raw difference is exactly 0.000 — the future set neither adds requirements nor raises targets, and today's accepted evidence already covers it."
                      : futureDelta.raw > 0
                        ? "The future target adds requirements or raises targets; today's accepted evidence still covers more of it than the current bar."
                        : "The future target is larger or harder — today's evidence covers less of it. This is a harder target, not a broken score."}
                    {results.future.scoring.derivation &&
                      ` ${results.future.scoring.derivation.added.length} future addition(s), ${results.future.scoring.derivation.raised.length} raised target(s).`}
                  </p>
                </div>
              )}

              {/* derivation chips */}
              {results.future?.scoring.derivation && (() => {
                const d = results.future.scoring.derivation;
                const any = d.added.length > 0 || d.raised.length > 0 || d.obsolete.length > 0;
                if (!any) return null;
                return (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {d.added.map((s) => (
                      <span key={`a-${s}`} className="rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">Added: {s}</span>
                    ))}
                    {d.raised.map((s) => (
                      <span key={`r-${s}`} className="rounded-md bg-accent/20 px-2.5 py-1 text-[11px] font-semibold text-accent">Raised target: {s}</span>
                    ))}
                    {d.obsolete.map((s) => (
                      <span key={`o-${s}`} className="rounded-md bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">Obsolete: {s}</span>
                    ))}
                  </div>
                );
              })()}

              <p className="mt-3 text-xs leading-relaxed text-foreground">
                <b className="text-primary">How to read this:</b> <b>Current verified readiness</b> measures accepted
                evidence against today's requirements. <b>Future-target readiness today</b> measures the SAME evidence
                against the resolved 12–24 month target (current still-relevant + additions + raised targets) with no
                assumed learning — it legitimately dips when the future role demands more. A <b>development forecast</b>{" "}
                is only produced from an approved plan with skill-specific activities, baseline, target and an assessment
                gate; it is never inferred from fixed learning constants.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <FitCard fit={results.current} lineage={results.lineage ?? undefined} />
              {results.future ? (
                <FitCard fit={results.future} lineage={results.lineage ?? undefined} />
              ) : (
                <div className="flex flex-col gap-3 rounded-lg bg-white p-6">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-extrabold tracking-tight text-foreground">Future requirements</h3>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted p-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Future readiness</p>
                      <p className="mt-1 text-lg font-extrabold text-foreground">Future requirements not defined</p>
                    </div>
                    <Clock className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    This demand has no future-skills definition yet. No future score is computed — a fabricated 0 or 100
                    would be meaningless. Edit the role's future requirements to enable the 12–24 month outlook.
                  </p>
                </div>
              )}
            </div>

            {futureDiff && (futureDiff.added.length > 0 || futureDiff.raised.length > 0 || futureDiff.removed.length > 0) && (
              <div className="mt-6 rounded-lg bg-white p-5 text-sm">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <Workflow className="h-4 w-4 text-primary" /> How the future target differs from today
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The future target is the resolved set (current still-relevant + additions + raised targets). A lower
                  future score is legitimate — a harder or larger target, not an inflated number.
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {futureDiff.added.map((s) => (
                    <li key={`a-${s.skill}`} className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Added: {s.skill} @ {s.target_proficiency}</li>
                  ))}
                  {futureDiff.raised.map((s) => (
                    <li key={`r-${s.skill}`} className="rounded-md bg-accent/20 px-2.5 py-1 text-xs font-semibold text-accent">Raised target: {s.skill} @ {s.target_proficiency}</li>
                  ))}
                  {futureDiff.removed.map((s) => (
                    <li key={`d-${s.skill}`} className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">Not in future list (kept unless marked obsolete): {s.skill}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* verified vs provisional coverage */}
            {coverage && coverage.directTotal > 0 && (
              <div className="mt-6 rounded-lg bg-white p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <BadgeCheck className="h-4 w-4 text-primary" /> Verified coverage vs provisional claims
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-xs font-semibold text-muted-foreground">Direct skills in role</p>
                    <p className="text-xl font-extrabold text-foreground">{coverage.directTotal}</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-xs font-semibold text-muted-foreground">Verified coverage</p>
                    <p className="text-xl font-extrabold text-secondary">{coverage.verified}</p>
                    <p className="text-[10px] text-muted-foreground">reviewer-confirmed or assessment-supported</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-xs font-semibold text-muted-foreground">Provisional claims</p>
                    <p className="text-xl font-extrabold text-accent">{coverage.unverified}</p>
                    <p className="text-[10px] text-muted-foreground">self-reported or extracted only</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-xs font-semibold text-muted-foreground">Missing evidence</p>
                    <p className="text-xl font-extrabold text-foreground">{coverage.missing}</p>
                    <p className="text-[10px] text-muted-foreground">no recorded assertion</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  Verified readiness counts only accepted independent evidence — keywords alone never satisfy a mandatory
                  gate. The provisional profile match includes claims, each attenuated by its evidence quality.
                </p>
              </div>
            )}

            {/* Phase 9: requirement-by-requirement matrix */}
            <div className="mt-8 rounded-lg bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                    <Workflow className="h-5 w-5 text-primary" strokeWidth={2.5} /> Requirements versus evidence
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    One row per requirement of the <b>{matrixScenario}</b> scenario ({matrixFit?.scoring.requirements.length ?? 0} requirements).
                    "Effective" is the level credit applied; "gap" is target minus effective.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-md ring-1 ring-border">
                    {(["current", "future"] as const).map((sc) => (
                      <button
                        key={sc}
                        onClick={() => setMatrixScenario(sc)}
                        className={`px-3 py-1.5 text-xs font-bold capitalize ${matrixScenario === sc ? "bg-foreground text-white" : "bg-white text-muted-foreground"}`}
                      >
                        {sc}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
                    <Filter className="h-3.5 w-3.5" />
                    <select
                      value={matrixFilter}
                      onChange={(e) => setMatrixFilter(e.target.value as "all" | FitClassification)}
                      className="bg-transparent text-xs font-semibold text-foreground focus:outline-none"
                      aria-label="Filter matrix rows"
                    >
                      <option value="all">All states</option>
                      {(Object.keys(CLASS_META) as FitClassification[]).map((c) => (
                        <option key={c} value={c}>{CLASS_META[c].label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="border-b-2 border-border text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-3">Requirement</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Target</th>
                      <th className="py-2 pr-3">Observed</th>
                      <th className="py-2 pr-3">Evidence state</th>
                      <th className="py-2 pr-3">Effective</th>
                      <th className="py-2 pr-3">Gap</th>
                      <th className="py-2 pr-3">Relationship</th>
                      <th className="py-2 pr-3">Freshness</th>
                      <th className="py-2">Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((item) => {
                      const meta = CLASS_META[item.classification];
                      const assertion = results?.lineage?.assertions.find((a) => a.skill_name?.toLowerCase() === item.skill.toLowerCase());
                      const stateMeta = STATE_META[item.evidence_state ?? ""] ?? (item.evidence_state ? { label: item.evidence_state, chip: "bg-muted text-foreground" } : null);
                      return (
                        <tr key={`${matrixScenario}-${item.skill}`} className="border-b border-border/60 align-top">
                          <td className="py-2.5 pr-3 font-bold text-foreground">
                            {item.skill}
                            <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: meta.color }} title={meta.hint} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${item.mandatory ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"}`}>
                              {item.mandatory ? "Mandatory" : "Preferred"}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 font-semibold text-foreground">{item.required_proficiency}</td>
                          <td className="py-2.5 pr-3 text-foreground">
                            {item.candidate_proficiency !== null ? item.candidate_proficiency : "—"}
                            {item.relationship === "adjacent" && item.edge && (
                              <span className="block text-[10px] text-muted-foreground">via {item.edge.from_skill}</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            {stateMeta ? (
                              <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stateMeta.chip}`}>{stateMeta.label}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                            {assertion && <span className="ml-1 text-[10px] text-muted-foreground">level {assertion.claimed_proficiency}</span>}
                          </td>
                          <td className="py-2.5 pr-3 font-semibold text-foreground">{item.effective_proficiency.toFixed(1)}</td>
                          <td className="py-2.5 pr-3">
                            <span className={item.gap > 0 ? "font-semibold text-accent" : "font-semibold text-secondary"}>{item.gap > 0 ? item.gap.toFixed(1) : "0"}</span>
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">{item.relationship}</span>
                            {item.edge && (
                              <span className="block font-mono text-[10px] text-muted-foreground">
                                {item.edge.from_skill} → {item.skill}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                            {item.freshness_days !== null ? `${item.freshness_days}d` : "—"}
                            {item.evidence_source && item.evidence_source.startsWith("artifact") && (
                              <span className="block font-mono text-[9px]">{item.evidence_source.split("|").slice(1).join("|").slice(0, 24)}</span>
                            )}
                          </td>
                          <td className="py-2.5 text-xs leading-relaxed text-muted-foreground">
                            {item.next_action}
                            {item.limitation && (
                              <span className="mt-1 flex items-start gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                                <Info className="mt-0.5 h-3 w-3 shrink-0" /> {item.limitation}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Evidence confidence {Math.round((matrixFit?.evidence_confidence ?? 0) * 100)}/100 ·{" "}
                {results.artifacts?.count ?? 0} independent artifact(s) backing the scored skills (deduplicated by source).
                Seniority is context only and never contributes to these numbers.
              </p>
            </div>

            {/* Evidence-driven person skill network */}
            <div className="mt-8 rounded-lg bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                  <Share2 className="h-5 w-5 text-primary" strokeWidth={2.5} /> Person skill network
                </h2>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {results.current.scoring.requirements.length} requirements · stored edges only
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                The role sits at the center; nodes are this person's requirements colored by support classification.
                Lines are only taxonomy edges stored in the skill graph between skills that both appear here — a
                relationship is never proof of mastery. Click a node for its detail.
              </p>
              <PersonSkillNetwork
                roleTitle={results.current.target_title}
                items={results.current.scoring.requirements}
                graph={graph.data ?? []}
                onSelect={(skill) => setFocusedSkill(skill)}
              />
              {focusedSkill && (() => {
                const node = results.current.scoring.requirements.find((r) => r.skill === focusedSkill);
                if (!node) return null;
                const meta = CLASS_META[node.classification];
                return (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ background: meta.color }} />
                        {node.skill}
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{meta.label}</span>
                      </p>
                      <button onClick={() => setFocusedSkill(null)} className="text-xs font-bold text-muted-foreground hover:text-foreground">Close</button>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{node.reason}</p>
                    <p className="text-xs font-semibold text-foreground">{node.next_action}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>Target {node.required_proficiency}</span>
                      <span>Observed {node.candidate_proficiency ?? "—"}</span>
                      <span>Effective {node.effective_proficiency.toFixed(1)}</span>
                      <span>Gap {node.gap.toFixed(1)}</span>
                      <span>{node.mandatory ? "Mandatory" : "Preferred"}</span>
                    </div>
                    {node.edge && (
                      <p className="font-mono text-[11px] text-foreground">
                        {node.edge.from_skill} → {node.skill} · {EDGE_HUMAN[node.edge.type] ?? node.edge.type} w{node.edge.weight.toFixed(2)}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Analysis: strengths / close paths / gaps (honest "no gaps" logic) */}
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg bg-muted p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-secondary">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified strengths
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm text-foreground">
                    {results.current.scoring.requirements.filter((i) => i.classification === "verified_direct").map((i) => (
                      <li key={i.skill}>· {i.skill} — level {i.candidate_proficiency}/{i.required_proficiency}</li>
                    ))}
                    {results.current.scoring.requirements.filter((i) => i.classification === "verified_direct").length === 0 && (
                      <li className="text-muted-foreground">No requirement is met with accepted evidence yet.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
                    <Workflow className="h-3.5 w-3.5" /> Adjacent / transferable paths
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm text-foreground">
                    {results.current.scoring.requirements.filter((i) => i.relationship === "adjacent" || i.relationship === "transferable").slice(0, 6).map((i) => (
                      <li key={`${i.skill}-${i.relationship}`}>
                        · <span className="font-semibold">{i.skill}</span> — {i.relationship === "adjacent" ? (i.edge ? `via ${i.edge.from_skill}` : "adjacent") : "transferable only"}
                      </li>
                    ))}
                    {results.current.scoring.requirements.filter((i) => i.relationship === "adjacent" || i.relationship === "transferable").length === 0 && (
                      <li className="text-muted-foreground">No adjacent or transferable support recorded.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-destructive">
                    <Target className="h-3.5 w-3.5" /> Gaps to close
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm text-foreground">
                    {unmet.slice(0, 8).map((i) => (
                      <li key={i.skill}>· <span className="font-semibold">{i.skill}</span> — {i.reason}</li>
                    ))}
                    {/* "No skill gaps" only when every requirement is genuinely at/above the bar —
                        transferable/missing skills ARE gaps and must never be hidden. */}
                    {unmet.length === 0 && results.current.scoring.requirements.length > 0 && (
                      <li className="text-muted-foreground">No skill gaps — every requirement is at or above its bar.</li>
                    )}
                    {unmet.length === 0 && results.current.scoring.requirements.length === 0 && (
                      <li className="text-muted-foreground">No requirements defined for this demand.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}

        {!results && (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
            <Share2 className="h-8 w-8 text-primary" strokeWidth={2.5} />
            <p className="text-sm text-muted-foreground">
              Select a person and a demand to assess their evidence. Nothing is computed until you choose both — no
              default mass assessment.
            </p>
          </div>
        )}

        {/* Searchable taxonomy — collapsible "Explore skill taxonomy" */}
        <div className="mt-16">
          <button
            onClick={() => setTaxonomyOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-left"
          >
            <span>
              <h2 className="text-xl font-extrabold tracking-tight text-foreground">Explore skill taxonomy</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Typed relationships between skills — {EDGE_HUMAN.ADJACENT_TO}, {EDGE_HUMAN.TRANSFERABLE_TO}, {EDGE_HUMAN.PREREQUISITE_OF}. Click a skill to see its focused ego network.
              </p>
            </span>
            {taxonomyOpen ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
          </button>

          {taxonomyOpen && (
            <div className="mt-4">
              <label className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={taxSearch}
                  onChange={(e) => setTaxSearch(e.target.value)}
                  placeholder="Search skills…"
                  className="w-48 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  aria-label="Search skills"
                />
              </label>

              {focusedSkill && focusedNode && (
                <div className="mt-5 rounded-lg bg-foreground p-5 text-white">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-lg font-extrabold">
                      {focusedNode.skill}
                      <span className="ml-2 rounded bg-white/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider">{focusedNode.category}</span>
                    </p>
                    <button onClick={() => setFocusedSkill(null)} className="flex items-center gap-1 text-xs font-bold text-white/70 hover:text-white">
                      <X className="h-3.5 w-3.5" /> Close
                    </button>
                  </div>

                  <EgoNetwork center={focusedNode.skill} nodes={graph.data ?? []} reverseEdges={reverseEdges} onSelect={setFocusedSkill} />

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-white/60">Outgoing relationships</p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {focusedNode.outgoing_edges.length === 0 && <li className="text-sm text-white/60">No outgoing relationships.</li>}
                        {focusedNode.outgoing_edges.map((e) => (
                          <li key={`${e.target_skill}-${e.type}`} className="rounded bg-white/10 p-2.5 text-sm">
                            <span className="font-bold">{focusedNode.skill}</span> → <span className="font-bold">{e.target_skill}</span>
                            <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">{EDGE_HUMAN[e.type] ?? e.type} · weight {e.weight.toFixed(2)}</span>
                            <p className="mt-1 text-xs text-white/70">{EDGE_LIMITATION[e.type] ?? ""}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-white/60">What leads into it</p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {(reverseEdges.get(focusedNode.skill.toLowerCase()) ?? []).length === 0 && (
                          <li className="text-sm text-white/60">Nothing in the taxonomy points here.</li>
                        )}
                        {(reverseEdges.get(focusedNode.skill.toLowerCase()) ?? []).map((e, i) => (
                          <li key={i} className="rounded bg-white/10 p-2.5 text-sm">
                            <span className="font-bold">{e.from}</span> → <span className="font-bold">{focusedNode.skill}</span>
                            <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">{EDGE_HUMAN[e.type] ?? e.type} · weight {e.weight.toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {filteredCategories.map(([category, nodes]) => (
                  <div key={category} className="rounded-lg bg-muted p-5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{category}</h3>
                    <div className="mt-3 flex flex-col gap-2">
                      {nodes.map((node) => {
                        const edgeLabel = node.outgoing_edges.length === 0 ? "no relationships" : `${node.outgoing_edges.length} relationship(s)`;
                        return (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => setFocusedSkill(node.skill)}
                            className={`rounded-md bg-white px-3 py-2.5 text-left transition-all hover:scale-[1.02] ${focusedSkill === node.skill ? "ring-2 ring-inset ring-primary" : ""}`}
                          >
                            <span className="text-sm font-bold text-foreground">{node.skill}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{edgeLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {filteredCategories.length === 0 && (
                  <p className="rounded-lg bg-muted p-6 text-sm text-muted-foreground">No skills match "{taxSearch}".</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/**
 * A focused ego-network rendered as SVG. Only the center skill and its DIRECT
 * neighbors are drawn — never the whole taxonomy. Outgoing edges go right,
 * incoming edges come from the left. Clicking a neighbor re-centers the network.
 */
function EgoNetwork({
  center,
  nodes,
  reverseEdges,
  onSelect,
}: {
  center: string;
  nodes: GraphNode[];
  reverseEdges: Map<string, { from: string; type: string; weight: number }[]>;
  onSelect: (skill: string) => void;
}) {
  const centerNode = nodes.find((n) => n.skill === center);
  const outgoing = centerNode?.outgoing_edges ?? [];
  const incoming = reverseEdges.get(center.toLowerCase()) ?? [];

  const outNodes = outgoing.map((e) => nodes.find((n) => n.skill.toLowerCase() === e.target_skill.toLowerCase())?.skill ?? e.target_skill);
  const inNodes = incoming.map((e) => e.from);
  const uniqueOut = [...new Set(outNodes)];
  const uniqueIn = [...new Set(inNodes)];

  const W = 560;
  const H = 240;
  const CX = W / 2;
  const CY = H / 2;

  const outPos = uniqueOut.map((s, i) => {
    const n = uniqueOut.length;
    const angle = -Math.PI / 2 + (n > 1 ? (i / (n - 1)) * Math.PI : 0);
    return { skill: s, x: CX + 150 + Math.cos(angle) * 70, y: CY + Math.sin(angle) * 90, center: false };
  });
  const inPos = uniqueIn.map((s, i) => {
    const n = uniqueIn.length;
    const angle = -Math.PI / 2 + (n > 1 ? (i / (n - 1)) * Math.PI : 0);
    return { skill: s, x: CX - 150 - Math.cos(angle) * 70, y: CY + Math.sin(angle) * 90, center: false };
  });
  const all = [{ skill: center, x: CX, y: CY, center: true }, ...outPos, ...inPos];

  const edgeStyle = (type: string) => {
    const m = EDGE_LEGEND[type] ?? { label: type, color: "#94a3b8" };
    return { stroke: m.color, strokeWidth: 1.6, strokeDasharray: m.dashed ? "5 4" : undefined };
  };

  return (
    <div className="mt-4 rounded-lg bg-white/10 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Connection network around ${center}`}>
        {outgoing.map((e) => {
          const t = outPos.find((p) => p.skill.toLowerCase() === e.target_skill.toLowerCase());
          if (!t) return null;
          return <line key={`o-${e.target_skill}-${e.type}`} x1={CX} y1={CY} x2={t.x} y2={t.y} {...edgeStyle(e.type)} />;
        })}
        {incoming.map((e) => {
          const f = inPos.find((p) => p.skill.toLowerCase() === e.from.toLowerCase());
          if (!f) return null;
          return <line key={`i-${e.from}-${e.type}`} x1={f.x} y1={f.y} x2={CX} y2={CY} {...edgeStyle(e.type)} />;
        })}
        {all.map((n) => (
          <g key={n.skill} transform={`translate(${n.x}, ${n.y})`}>
            <circle
              r={n.center ? 26 : 20}
              fill={n.center ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)"}
              stroke={n.center ? "#ffffff" : "rgba(255,255,255,0.5)"}
              strokeWidth={n.center ? 2 : 1.2}
              onClick={() => !n.center && onSelect(n.skill)}
              style={{ cursor: n.center ? "default" : "pointer" }}
            />
            <text
              textAnchor="middle"
              dy="0.35em"
              className="text-[10px] font-bold"
              fill="#ffffff"
              style={{ pointerEvents: "none" }}
            >
              {n.skill.length > 12 ? `${n.skill.slice(0, 11)}…` : n.skill}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-white/80">
        {Object.entries(EDGE_LEGEND).map(([type, m]) => (
          <span key={type} className="flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="22" y2="3" stroke={m.color} strokeWidth="1.6" strokeDasharray={m.dashed ? "5 4" : undefined} />
            </svg>
            {m.label}
          </span>
        ))}
        <span className="text-white/50">· A path between skills is a relationship, never proof of mastery in the target skill.</span>
      </div>
    </div>
  );
}

/** Distinct SVG node shapes per support classification (shape + color, so the
 *  legend is never color-only). */
function NodeShape({ cls, color, x, y }: { cls: FitClassification; color: string; x: number; y: number }) {
  const fill = cls === "missing" ? "transparent" : color;
  const stroke = color;
  switch (cls) {
    case "verified_direct":
      return <circle cx={x} cy={y} r={14} fill={fill} stroke={stroke} strokeWidth={2} />;
    case "provisional_direct":
      return <circle cx={x} cy={y} r={14} fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray="4 3" />;
    case "below_target":
      return (
        <g transform={`translate(${x}, ${y})`}>
          <rect x={-12} y={-12} width={24} height={24} rx={3} fill={fill} stroke={stroke} strokeWidth={2} />
        </g>
      );
    case "adjacent_support":
      return (
        <g transform={`translate(${x}, ${y})`}>
          <polygon points="0,-13 13,9 -13,9" fill={fill} stroke={stroke} strokeWidth={2} />
        </g>
      );
    case "transferable_foundation":
      return (
        <g transform={`translate(${x}, ${y})`}>
          <polygon points="0,13 13,-9 -13,-9" fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray="4 3" />
        </g>
      );
    case "missing":
      return (
        <g transform={`translate(${x}, ${y})`} stroke={stroke} strokeWidth={2.5} strokeLinecap="round">
          <line x1={-9} y1={-9} x2={9} y2={9} />
          <line x1={9} y1={-9} x2={-9} y2={9} />
        </g>
      );
  }
}

/**
 * Person skill network: requirements mapped against the role (center), colored
 * and shaped by support classification. Only STORED taxonomy edges between
 * skills that both appear are drawn. Clicking a node surfaces its detail.
 */
function PersonSkillNetwork({
  roleTitle,
  items,
  graph,
  onSelect,
}: {
  roleTitle: string;
  items: { skill: string; classification: FitClassification }[];
  graph: GraphNode[];
  onSelect: (skill: string) => void;
}) {
  const unique = [...new Set(items.map((i) => i.skill))];
  const clsOf = new Map<string, FitClassification>();
  for (const i of items) if (!clsOf.has(i.skill)) clsOf.set(i.skill, i.classification);

  const lower = new Set(unique.map((s) => s.toLowerCase()));
  const edges: { from: string; to: string; type: string }[] = [];
  for (const n of graph) {
    for (const e of n.outgoing_edges) {
      if (lower.has(n.skill.toLowerCase()) && lower.has(e.target_skill.toLowerCase())) {
        edges.push({ from: n.skill, to: e.target_skill, type: e.type });
      }
    }
  }

  const W = 680;
  const H = 400;
  const CX = W / 2;
  const CY = H / 2;
  const pos = unique.map((s, i) => {
    const a = -Math.PI / 2 + (unique.length > 1 ? (i / unique.length) * Math.PI * 2 : 0);
    return { skill: s, x: CX + Math.cos(a) * 250, y: CY + Math.sin(a) * 140 };
  });
  const short = (s: string) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Skill network for ${roleTitle}`}>
        {edges.map((e, i) => {
          const f = pos.find((p) => p.skill === e.from);
          const t = pos.find((p) => p.skill === e.to);
          if (!f || !t) return null;
          const m = EDGE_LEGEND[e.type] ?? { label: e.type, color: "#94a3b8" };
          return (
            <line
              key={`e-${i}`}
              x1={f.x}
              y1={f.y}
              x2={t.x}
              y2={t.y}
              stroke={m.color}
              strokeWidth={1.6}
              strokeDasharray={m.dashed ? "5 4" : undefined}
              opacity={0.75}
            />
          );
        })}
        <g transform={`translate(${CX}, ${CY})`}>
          <circle r={30} fill="rgba(109,94,252,0.12)" stroke="var(--primary)" strokeWidth={2} />
          <text textAnchor="middle" dy="0.35em" className="text-[10px] font-bold" fill="var(--primary)">
            {short(roleTitle || "Role")}
          </text>
        </g>
        {pos.map((p) => {
          const cls = clsOf.get(p.skill) ?? "missing";
          const color = CLASS_META[cls].color;
          return (
            <g
              key={p.skill}
              transform={`translate(${p.x}, ${p.y})`}
              onClick={() => onSelect(p.skill)}
              style={{ cursor: "pointer" }}
            >
              <NodeShape cls={cls} color={color} x={0} y={0} />
              <text textAnchor="middle" dy="3.4em" className="text-[9px] font-bold" fill="var(--foreground)">
                {short(p.skill)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {(Object.keys(CLASS_META) as FitClassification[]).map((cls) => (
          <span key={cls} className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <NodeShape cls={cls} color={CLASS_META[cls].color} x={7} y={7} />
            </svg>
            {CLASS_META[cls].label}
          </span>
        ))}
        <span className="text-border">|</span>
        {Object.entries(EDGE_LEGEND).map(([type, m]) => (
          <span key={type} className="flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="22" y2="3" stroke={m.color} strokeWidth="1.6" strokeDasharray={m.dashed ? "5 4" : undefined} />
            </svg>
            {m.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        The role sits at the center; nodes are this person's requirements. Lines are taxonomy relationships stored in
        the skill graph between skills that both appear here — a relationship is never proof of mastery in the target skill.
      </p>
    </div>
  );
}
