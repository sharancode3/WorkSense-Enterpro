import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Info, Loader2, Lock, Search, Share2, ShieldCheck, Sparkles, Target, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { FitCard } from "@/components/fit-card";
import { computeSkillFit, coverageBreakdown, futureRequirementDiff, projectedFutureReadiness, type FitLineage, type FitRecord, type GraphNode, type SkillMatchResult } from "@/lib/skill-graph";
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
  disputed: { label: "Disputed", chip: "bg-destructive/20 text-destructive" },
  superseded: { label: "Superseded", chip: "bg-muted text-muted-foreground" },
};

const EDGE_LIMITATION: Record<string, string> = {
  ADJACENT_TO: "Related but not equivalent — capability in the required skill is not yet evidenced.",
  TRANSFERABLE_TO: "Transferable signal only — establishes no proficiency and earns no points.",
  PREREQUISITE_OF: "Prerequisite relationship — the target typically builds on this skill.",
};

const EDGE_LEGEND: Record<string, { label: string; color: string; dashed?: boolean }> = {
  ADJACENT_TO: { label: "Related skill", color: "var(--primary, #6d5efc)" },
  TRANSFERABLE_TO: { label: "Transferable experience", color: "var(--secondary, #0ea5a4)", dashed: true },
  PREREQUISITE_OF: { label: "Prerequisite", color: "var(--accent, #f59e0b)" },
};

// Batch E (E4): results are BOUND to the person + demand they were computed
// for. Changing either marks them outdated; late responses are ignored.
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
  const [twinId, setTwinId] = useState("");
  const [reqId, setReqId] = useState("");
  const [results, setResults] = useState<MatchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxSearch, setTaxSearch] = useState("");
  const [focusedSkill, setFocusedSkill] = useState<string | null>(null);
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

  // Batch E (E4): identity-bound run with a late-response guard.
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

  // Selecting a person (and a demand) computes the graph immediately — no need
  // to scroll back up to press "Compute coverage". Selecting either side again
  // re-runs for the new selection; already-computed selections are not
  // recomputed on every render.
  useEffect(() => {
    if (!twinId || !reqId) return;
    if (results && results.twinId === twinId && results.reqId === reqId) return;
    void runMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twinId, reqId]);

  // E1: what changed between current and future requirement sets.
  const futureDiff = useMemo(() => {
    const reqRow = (reqs.data ?? []).find((r) => r.id === results?.reqId);
    if (!reqRow) return null;
    const cur = (reqRow.required_skills ?? []) as { skill: string; target_proficiency: number }[];
    const fut = (reqRow.future_skills ?? []) as { skill: string; target_proficiency: number }[];
    if (fut.length === 0) return null;
    const d = futureRequirementDiff(cur, fut);
    return d.added.length > 0 || d.raised.length > 0 || d.removed.length > 0 ? d : null;
  }, [reqs.data, results?.reqId]);

  // E2: verified coverage vs profile match (claims included).
  const coverage = useMemo(() => {
    if (!results?.current || !results.lineage) return null;
    const c = coverageBreakdown(results.current.classification.direct, results.lineage.assertions);
    return c.directTotal > 0 ? c : null;
  }, [results]);

  // §53: computed development trajectory for the future outlook — models the
  // person closing every future gap that already has a real foundation.
  const futureProj = useMemo(() => {
    if (!results?.future) return null;
    return projectedFutureReadiness(results.future);
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

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Skill Development · Evidence-based</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Capability against a chosen demand
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Pick a person and a demand to see how their <b>verified evidence</b> maps to the requirements. Every skill is
            shown with its support state (self-reported, extracted, assessment-supported, or reviewer-verified), the
            source artifact and excerpt, and what still needs verification. Adjacent or transferable support is labeled
            as such — it is never presented as direct capability. The overall match includes claims; verified coverage
            is shown separately.
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
            {/* E4: outdated-selection banner — results are bound to a selection. */}
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

            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <FitCard fit={results.current} lineage={results.lineage ?? undefined} />
              {results.future ? (
                <FitCard fit={results.future} lineage={results.lineage ?? undefined} />
              ) : (
                /* E1: empty future requirements are shown honestly, never as a fabricated score. */
                <div className="flex flex-col gap-3 rounded-lg bg-white p-6">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-extrabold tracking-tight text-foreground">Future requirements</h3>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted p-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Future readiness</p>
                      <p className="mt-1 text-lg font-extrabold text-foreground">Future requirements not defined</p>
                    </div>
                    <Sparkles className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    This demand has no future-skills definition yet. No future score is computed — a fabricated 0 or 100
                    would be meaningless. Edit the role's future requirements to enable the 12–24 month outlook.
                  </p>
                </div>
              )}
            </div>

            {/* E1: changed requirements between current and future */}
            {futureDiff && (futureDiff.added.length > 0 || futureDiff.raised.length > 0 || futureDiff.removed.length > 0) && (
              <div className="mt-6 rounded-lg bg-white p-5 text-sm">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <Workflow className="h-4 w-4 text-primary" /> How the future target differs from today
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  A lower future score can be legitimate — the future target is harder or different, not inflated. The{" "}
                  <b className="text-foreground">development trajectory</b> above shows the computed growth path back up
                  when the person closes foundation-backed gaps.
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {futureDiff.added.map((s) => (
                    <li key={`a-${s.skill}`} className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Added: {s.skill} @ {s.target_proficiency}</li>
                  ))}
                  {futureDiff.raised.map((s) => (
                    <li key={`r-${s.skill}`} className="rounded-md bg-accent/20 px-2.5 py-1 text-xs font-semibold text-accent">Raised target: {s.skill} @ {s.target_proficiency}</li>
                  ))}
                  {futureDiff.removed.map((s) => (
                    <li key={`d-${s.skill}`} className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">No longer required: {s.skill}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* E2: claim-inclusive match vs verified coverage */}
            {coverage && coverage.directTotal > 0 && (
              <div className="mt-6 rounded-lg bg-white p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <BadgeCheck className="h-4 w-4 text-primary" /> Profile match vs verified coverage
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
                    <p className="text-xs font-semibold text-muted-foreground">Unverified claims</p>
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
                  The overall match percentage includes self-reported and extracted claims where evidence is thin.
                  Verified coverage counts only accepted independent evidence — keywords alone never satisfy a mandatory
                  gate.
                </p>
              </div>
            )}

            {/* Person skill network — visible edges + analysis + summary */}
            <div className="mt-8 rounded-lg bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                  <Share2 className="h-5 w-5 text-primary" strokeWidth={2.5} /> Person skill network
                </h2>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  computed for this selection
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Every skill this person maps against the role is a node; taxonomy relationships between those skills are drawn
                as edges (Related, Transferable, Prerequisite). Node color shows how each skill supports the match.
              </p>
              <PersonSkillNetwork
                roleTitle={results.current.target_title}
                items={results.current.classification.direct
                  .concat(results.current.classification.adjacent, results.current.classification.transferable, results.current.classification.gaps)}
                graph={graph.data ?? []}
              />

              {/* Summary strip */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Match score</p>
                  <p className="text-xl font-extrabold text-primary">{Math.round(results.current.score * 100)}%</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Verified skills</p>
                  <p className="text-xl font-extrabold text-secondary">{coverage?.verified ?? 0}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Claims</p>
                  <p className="text-xl font-extrabold text-accent">{results.lineage?.assertions.length ?? 0}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Gaps</p>
                  <p className="text-xl font-extrabold text-foreground">{results.current.classification.gaps.length}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Artifacts</p>
                  <p className="text-xl font-extrabold text-foreground">{results.artifacts?.count ?? 0}</p>
                </div>
              </div>

              {/* Analysis */}
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg bg-muted p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-secondary">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified strengths
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm text-foreground">
                    {(() => {
                      const strong = results.current.classification.direct.filter((i) => (i.candidate_proficiency ?? 0) >= i.required_proficiency);
                      return strong.length > 0
                        ? strong.map((i) => <li key={i.skill}>· {i.skill} — level {i.candidate_proficiency}/{i.required_proficiency}</li>)
                        : [<li key="none" className="text-muted-foreground">No direct skill reaches its target bar yet.</li>];
                    })()}
                  </ul>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
                    <Sparkles className="h-3.5 w-3.5" /> Close / transferable paths
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm text-foreground">
                    {results.current.classification.adjacent.concat(results.current.classification.transferable).slice(0, 5).map((i) => (
                      <li key={`${i.skill}-${i.classification}`}>
                        · <span className="font-semibold">{i.skill}</span> — {i.reason}
                        {i.edge ? ` (via ${i.edge.from_skill})` : ""}
                      </li>
                    ))}
                    {results.current.classification.adjacent.concat(results.current.classification.transferable).length === 0 && (
                      <li className="text-muted-foreground">No adjacent or transferable support recorded.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-destructive">
                    <Target className="h-3.5 w-3.5" /> Gaps to close
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm text-foreground">
                    {results.current.classification.gaps.slice(0, 6).map((i) => (
                      <li key={i.skill}>· <span className="font-semibold">{i.skill}</span> — {i.reason}</li>
                    ))}
                    {results.current.classification.gaps.length === 0 && <li className="text-muted-foreground">No skill gaps for the current scenario.</li>}
                  </ul>
                </div>
              </div>

              {/* §53: development trajectory — the future score can dip, but the
                  projection shows growth from evidence-grounded development. */}
              {results.future && futureProj && (() => {
                const today = Math.round(results.current.score * 100);
                const target = Math.round(results.future.score * 100);
                const projected = Math.round(futureProj.score * 100);
                const steps = [today, target, projected];
                const min = Math.min(...steps) - 10;
                const max = Math.max(...steps) + 10;
                const pos = (v: number) => ((v - min) / Math.max(1, max - min)) * 100;
                return (
                  <div className="mt-5 rounded-lg border-2 border-primary/15 bg-primary/5 p-4">
                    <p className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                      <Sparkles className="h-4 w-4 text-primary" strokeWidth={2.5} /> Development trajectory (12–24 months)
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      The raw future target can score lower than today because the role's future requirements are harder or
                      different. People learn — so we also compute what this person would reach if they{" "}
                      <b className="text-foreground">
                        closed every future requirement that already has a real foundation
                      </b>{" "}
                      ({futureProj.closable.length} skill{futureProj.closable.length === 1 ? "" : "s"}: a partial direct claim,
                      an adjacent path, or transferable experience). Pure gaps with no foundation stay open. Both numbers are
                      computed with the same weighted engine — never hard-coded.
                    </p>
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {[
                        { label: "Today", value: today, cls: "bg-foreground text-white" },
                        { label: "Future target (today's profile)", value: target, cls: target < today ? "bg-accent text-foreground" : "bg-secondary text-white" },
                        { label: "Projected with planned development", value: projected, cls: "bg-primary text-white" },
                      ].map((s) => (
                        <div key={s.label} className={`rounded-lg p-3.5 ${s.cls}`}>
                          <p className={`text-[10px] font-bold uppercase tracking-wider ${s.cls.includes("text-white") ? "text-white/70" : "text-foreground/60"}`}>{s.label}</p>
                          <p className="mt-1 text-2xl font-extrabold tracking-tight">{s.value}%</p>
                        </div>
                      ))}
                    </div>
                    <div className="relative mt-4 h-2 rounded-full bg-muted">
                      <div className="absolute h-full rounded-full bg-primary" style={{ left: `${pos(today)}%`, width: `${Math.max(2, pos(projected) - pos(today))}%` }} />
                      {[today, target, projected].map((v, i) => (
                        <span
                          key={`${v}-${i}`}
                          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow"
                          style={{ left: `${pos(v)}%` }}
                          title={`${["today", "future target", "projected"][i]}: ${v}%`}
                        />
                      ))}
                    </div>
                    <div className="mt-2 flex justify-between text-[11px] font-semibold text-muted-foreground">
                      <span>Today {today}%</span>
                      <span>Future target {target}%</span>
                      <span>Projected {projected}%</span>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-foreground">
                      <span className="font-bold text-primary">Read-out:</span>{" "}
                      {projected > target
                        ? `Development lifts the outlook from ${target}% to ${projected}% (+${projected - target} points).`
                        : `No foundation-backed future gaps remain — the outlook already matches the achievable ceiling.`}{" "}
                      {today > target && (
                        <span className="text-muted-foreground">
                          The dip from {today}% today to {target}% is because the role's future requirements are harder —
                          the projection below shows the growth path back up.
                        </span>
                      )}
                    </p>
                    {futureProj.closable.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {futureProj.closable.slice(0, 8).map((i) => (
                          <span key={`${i.skill}-${i.classification}`} className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-foreground ring-1 ring-border">
                            {i.skill} <span className="capitalize text-muted-foreground">({i.classification})</span>
                          </span>
                        ))}
                        {futureProj.closable.length > 8 && (
                          <span className="px-1 text-[11px] text-muted-foreground">+{futureProj.closable.length - 8} more</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Requirements-vs-evidence matrix + gap bars */}
            <div className="mt-8 rounded-lg bg-white p-6">
              <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                <Workflow className="h-5 w-5 text-primary" strokeWidth={2.5} /> Requirements versus evidence
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                One row per required skill (current scenario). Bars show the target (filled outline) against the person's
                current level. "Support state" is the strongest evidence behind the skill.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b-2 border-border text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-3">Requirement</th>
                      <th className="py-2 pr-3">Classification</th>
                      <th className="py-2 pr-3">Support state</th>
                      <th className="py-2 pr-3">Current vs target</th>
                      <th className="py-2">Path / reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.current.classification.direct
                      .concat(results.current.classification.adjacent, results.current.classification.transferable, results.current.classification.gaps)
                      .map((item) => {
                        const assertion = results.lineage?.assertions.find((a) => a.skill_name?.toLowerCase() === item.skill.toLowerCase());
                        const meta = STATE_META[assertion?.review_state ?? ""] ?? { label: "No evidence", chip: "bg-muted text-foreground" };
                        const holds = item.candidate_proficiency ?? 0;
                        const target = item.required_proficiency;
                        const pctHolds = Math.round((holds / 5) * 100);
                        const pctTarget = Math.round((target / 5) * 100);
                        return (
                          <tr key={`${item.skill}-${item.classification}`} className="border-b border-border/60 align-top">
                            <td className="py-2.5 pr-3 font-bold text-foreground">{item.skill}</td>
                            <td className="py-2.5 pr-3">
                              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-foreground">
                                {item.classification}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${meta.chip}`}>{meta.label}</span>
                              {assertion && <span className="ml-1 text-xs text-muted-foreground">level {assertion.claimed_proficiency}</span>}
                            </td>
                            <td className="py-2.5 pr-3">
                              <div className="flex w-40 items-center gap-1.5">
                                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full bg-secondary" style={{ width: `${pctHolds}%` }} title={`holds ${holds}/5`} />
                                </div>
                                <span className="w-6 text-right text-[11px] font-bold text-foreground">{holds}</span>
                                <span className="text-[11px] text-muted-foreground">/ {target}</span>
                              </div>
                            </td>
                            <td className="py-2.5 text-xs leading-relaxed text-muted-foreground">
                              {item.edge && (
                                <span className="block font-mono text-[11px] text-foreground">
                                  {item.edge.from_skill} → {item.skill} · {item.edge.type} w{item.edge.weight.toFixed(2)}
                                </span>
                              )}
                              {item.reason}
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
                Evidence count uses <b>independent artifacts</b> (deduplicated): multiple assertions from the same
                resume or work sample count once.
                {results.artifacts && (
                  <>
                    {" "}This person currently has <b>{results.artifacts.count} independent artifact(s)</b> backing their scored skills.
                  </>
                )}
              </p>
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

        {/* Searchable taxonomy + focused relationship view (E5) */}
        <div className="mt-16">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-foreground">Connections</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Typed relationships between skills — Related skill, Transferable experience, Prerequisite. Click a skill
                to see its focused ego network (only its direct neighbors, never the whole taxonomy).
              </p>
            </div>
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
          </div>

          {focusedSkill && focusedNode && (
            <div className="mt-5 rounded-lg bg-foreground p-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <p className="text-lg font-extrabold">
                  {focusedNode.skill}
                  <span className="ml-2 rounded bg-white/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider">{focusedNode.category}</span>
                </p>
                <button onClick={() => setFocusedSkill(null)} className="text-xs font-bold text-white/70 hover:text-white">
                  Close
                </button>
              </div>

              {/* E5: focused SVG ego network */}
              <EgoNetwork center={focusedNode.skill} nodes={graph.data ?? []} reverseEdges={reverseEdges} onSelect={setFocusedSkill} />

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/60">Outgoing relationships</p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {focusedNode.outgoing_edges.length === 0 && <li className="text-sm text-white/60">No outgoing relationships.</li>}
                    {focusedNode.outgoing_edges.map((e) => (
                      <li key={`${e.target_skill}-${e.type}`} className="rounded bg-white/10 p-2.5 text-sm">
                        <span className="font-bold">{focusedNode.skill}</span> → <span className="font-bold">{e.target_skill}</span>
                        <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 font-mono text-[11px]">{e.type} · weight {e.weight.toFixed(2)}</span>
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
                        <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 font-mono text-[11px]">{e.type} · weight {e.weight.toFixed(2)}</span>
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
                  {nodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setFocusedSkill(node.skill)}
                      className={`rounded-md bg-white px-3 py-2.5 text-left transition-all hover:scale-[1.02] ${focusedSkill === node.skill ? "ring-2 ring-inset ring-primary" : ""}`}
                    >
                      <span className="text-sm font-bold text-foreground">{node.skill}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{node.outgoing_edges.length} edge(s)</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {filteredCategories.length === 0 && (
              <p className="rounded-lg bg-muted p-6 text-sm text-muted-foreground">No skills match "{taxSearch}".</p>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * E5: a focused ego-network rendered as SVG. Only the center skill and its
 * DIRECT neighbors are drawn — never the whole taxonomy. Outgoing edges go
 * right, incoming edges come from the left. Clicking a neighbor re-centers the
 * network on it. The relationship lists below the SVG remain the accessible
 * table/list alternative.
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
    const angle = -Math.PI / 2 + (n > 1 ? (i / (n - 1)) * Math.PI : 0); // right half
    return { skill: s, x: CX + 150 + Math.cos(angle) * 70, y: CY + Math.sin(angle) * 90, center: false };
  });
  const inPos = uniqueIn.map((s, i) => {
    const n = uniqueIn.length;
    const angle = -Math.PI / 2 + (n > 1 ? (i / (n - 1)) * Math.PI : 0); // left half
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
        {/* outgoing edges */}
        {outgoing.map((e) => {
          const t = outPos.find((p) => p.skill.toLowerCase() === e.target_skill.toLowerCase());
          if (!t) return null;
          return (
            <line key={`o-${e.target_skill}-${e.type}`} x1={CX} y1={CY} x2={t.x} y2={t.y} {...edgeStyle(e.type)} />
          );
        })}
        {/* incoming edges */}
        {incoming.map((e) => {
          const f = inPos.find((p) => p.skill.toLowerCase() === e.from.toLowerCase());
          if (!f) return null;
          return (
            <line key={`i-${e.from}-${e.type}`} x1={f.x} y1={f.y} x2={CX} y2={CY} {...edgeStyle(e.type)} />
          );
        })}
        {/* nodes */}
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
      {/* legend */}
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

/**
 * Person skill network: the skills a person maps against a role are laid out on
 * an ellipse around the role (center), and taxonomy relationships between those
 * skills are drawn as real edges. Node color = how the skill supports the match.
 */
function PersonSkillNetwork({
  roleTitle,
  items,
  graph,
}: {
  roleTitle: string;
  items: { skill: string; classification: string }[];
  graph: GraphNode[];
}) {
  const CLS_COLOR: Record<string, string> = {
    direct: "var(--secondary)",
    adjacent: "var(--accent)",
    transferable: "var(--primary)",
    gap: "var(--destructive)",
  };
  const CLS_LABEL: Record<string, string> = {
    direct: "Direct match",
    adjacent: "Adjacent",
    transferable: "Transferable",
    gap: "Gap",
  };

  const unique = [...new Set(items.map((i) => i.skill))];
  const clsOf = new Map<string, string>();
  for (const i of items) if (!clsOf.has(i.skill)) clsOf.set(i.skill, i.classification);

  // Edges between skills that are BOTH in this person's mapped set.
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
        {/* edges */}
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
        {/* role center */}
        <g transform={`translate(${CX}, ${CY})`}>
          <circle r={30} fill="rgba(109,94,252,0.12)" stroke="var(--primary)" strokeWidth={2} />
          <text textAnchor="middle" dy="0.35em" className="text-[10px] font-bold" fill="var(--primary)">
            {short(roleTitle || "Role")}
          </text>
        </g>
        {/* skill nodes */}
        {pos.map((p) => {
          const cls = clsOf.get(p.skill) ?? "gap";
          const color = CLS_COLOR[cls] ?? "#94a3b8";
          return (
            <g key={p.skill} transform={`translate(${p.x}, ${p.y})`}>
              <circle r={16} fill={color} fillOpacity={cls === "gap" ? 0.15 : 0.22} stroke={color} strokeWidth={1.6} />
              <text textAnchor="middle" dy="0.35em" className="text-[9px] font-bold" fill="var(--foreground)">
                {short(p.skill)}
              </text>
            </g>
          );
        })}
      </svg>
      {/* legend: classifications + edge types */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        {Object.entries(CLS_LABEL).map(([cls, label]) => (
          <span key={cls} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: CLS_COLOR[cls], opacity: 0.55 }} />
            {label}
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
        The role sits at the center; colored dots are this person's skills. Lines are taxonomy relationships between skills
        that both appear here — a relationship is never proof of mastery in the target skill.
      </p>
    </div>
  );
}
