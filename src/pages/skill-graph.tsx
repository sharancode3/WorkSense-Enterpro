import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2, Lock, Search, Share2, ShieldCheck, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { FitCard } from "@/components/fit-card";
import { computeSkillFit, type FitLineage, type FitRecord, type GraphNode, type SkillMatchResult } from "@/lib/skill-graph";
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

export default function SkillGraph() {
  const { role, twin: me, user } = useAuth();
  const [twinId, setTwinId] = useState("");
  const [reqId, setReqId] = useState("");
  const [current, setCurrent] = useState<FitRecord | null>(null);
  const [future, setFuture] = useState<FitRecord | null>(null);
  const [lineage, setLineage] = useState<FitLineage | null>(null);
  const [artifacts, setArtifacts] = useState<{ artifact_keys: string[]; count: number } | null>(null);
  const [scope, setScope] = useState<SkillMatchResult["scope"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxSearch, setTaxSearch] = useState("");
  const [focusedSkill, setFocusedSkill] = useState<string | null>(null);

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
    setBusy(true);
    setError(null);
    try {
      const [cur, fut] = await Promise.all([
        computeSkillFit({ twin_id: twinId, target_id: reqId, scenario: "current", force }),
        computeSkillFit({ twin_id: twinId, target_id: reqId, scenario: "future", force }),
      ]);
      setCurrent(cur.fit);
      setFuture(fut.fit);
      setLineage(cur.lineage ?? fut.lineage ?? null);
      setArtifacts(cur.evidence_artifacts ?? fut.evidence_artifacts ?? null);
      setScope(cur.scope ?? fut.scope ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill match failed");
    } finally {
      setBusy(false);
    }
  };

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
    scope === "self" ? "Your own skills" : scope === "team" ? "Your team" : scope === "candidates" ? "Authorized candidates" : "Organization";

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
            as such — it is never presented as direct capability. You are only ever assessed against a demand you
            select; nothing here evaluates everyone against every unrelated skill by default.
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
          <div className="flex items-end gap-3">
            <Button size="xl" className="flex-1" onClick={() => void runMatch()} disabled={busy || !twinId || !reqId}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-5 w-5" />}
              Compute coverage
            </Button>
            <Button variant="secondary" size="xl" onClick={() => void runMatch(true)} disabled={busy || !twinId || !reqId}>
              Recompute
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-lg bg-destructive p-4 text-white">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {current && future && (
          <>
            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <FitCard fit={current} lineage={lineage ?? undefined} />
              <FitCard fit={future} lineage={lineage ?? undefined} />
            </div>

            {/* Requirements-vs-evidence matrix + gap bars */}
            <div className="mt-8 rounded-lg bg-white p-6">
              <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                <Workflow className="h-5 w-5 text-primary" strokeWidth={2.5} /> Requirements versus evidence
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                One row per required skill. Bars show the target (filled outline) against the person's current level.
                "Support state" is the strongest evidence behind the skill.
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
                    {current.classification.direct
                      .concat(current.classification.adjacent, current.classification.transferable, current.classification.gaps)
                      .map((item) => {
                        const assertion = lineage?.assertions.find((a) => a.skill_name?.toLowerCase() === item.skill.toLowerCase());
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
                {artifacts && (
                  <>
                    {" "}This person currently has <b>{artifacts.count} independent artifact(s)</b> backing their scored skills.
                  </>
                )}
              </p>
            </div>
          </>
        )}

        {!current && (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
            <Share2 className="h-8 w-8 text-primary" strokeWidth={2.5} />
            <p className="text-sm text-muted-foreground">
              Select a person and a demand to assess their evidence. Nothing is computed until you choose both — no
              default mass assessment.
            </p>
          </div>
        )}

        {/* Searchable taxonomy + focused relationship view */}
        <div className="mt-16">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-foreground">Browse the skill taxonomy</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Typed relationships — PREREQUISITE_OF, ADJACENT_TO, TRANSFERABLE_TO. Click a skill to see its focused
                relationship view with weights and limitations.
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
