import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { BadgeCheck, Info, Search, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import type { GraphNode } from "@/lib/skill-graph";
import { can } from "@/lib/rbac";

interface TwinOption {
  id: string;
  name: string;
  role: string;
  department: string | null;
  job_title: string | null;
  manager_id: string | null;
}

interface PersonSkill {
  name: string;
  proficiency: number;
  rigor: string;
  evidence_source: string;
  category: string;
  nodeId: string | null;
  review_state: string | null;
}

const RIGOR_CHIP: Record<string, string> = {
  high: "bg-secondary text-white",
  medium: "bg-primary text-white",
  low: "bg-muted text-muted-foreground",
};

const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  reviewer_confirmed: { label: "Reviewer verified", cls: "bg-secondary text-white" },
  assessment_supported: { label: "Assessment supported", cls: "bg-primary text-white" },
  extracted: { label: "Extracted (unverified)", cls: "bg-muted text-muted-foreground" },
  claimed: { label: "Self-reported", cls: "bg-accent/15 text-foreground" },
  expired: { label: "Expired", cls: "bg-muted text-muted-foreground" },
  disputed: { label: "Disputed", cls: "bg-muted text-muted-foreground" },
};

export default function SkillGraph() {
  const { role, twin: me, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [twinId, setTwinId] = useState(() => searchParams.get("person") ?? "");
  const [taxSearch, setTaxSearch] = useState("");
  const [focusedSkill, setFocusedSkill] = useState<string | null>(null);

  const twins = useQuery({
    queryKey: ["graph-twins", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("digital_twins")
        .select("id, name, role, department, job_title, manager_id")
        .order("name");
      return (data ?? []) as TwinOption[];
    },
  });

  const graph = useQuery({
    queryKey: ["graph-nodes", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase.from("skill_graph").select("id, skill, category, outgoing_edges");
      return (data ?? []) as GraphNode[];
    },
  });

  // ---- Role-scoped person list (server enforces; this mirrors it) ----
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

  // Default to the person this account is about (self for employees).
  useEffect(() => {
    if (!twinId && scopedTwins.length > 0 && me) {
      const def = role === "employee" ? me.id : scopedTwins[0].id;
      setTwinId(def);
      setSearchParams({ person: def }, { replace: true });
    }
  }, [twinId, scopedTwins, me, role, setSearchParams]);

  const person = (twins.data ?? []).find((t) => t.id === twinId) ?? null;

  // The selected person's verified skills + assertion review states.
  const personData = useQuery({
    queryKey: ["person-skills", twinId],
    enabled: !!twinId,
    queryFn: async () => {
      const [twinRes, assertRes] = await Promise.all([
        supabase
          .from("digital_twins")
          .select("id, name, role, department, job_title, verified_skills")
          .eq("id", twinId)
          .maybeSingle(),
        supabase
          .from("skill_assertions")
          .select("skill_id, review_state, claimed_proficiency")
          .eq("twin_id", twinId),
      ]);
      return {
        twin: twinRes.data
          ? ({
              id: (twinRes.data as { id: string }).id,
              name: (twinRes.data as { name: string }).name,
              role: (twinRes.data as { role: string }).role,
              department: (twinRes.data as { department: string | null }).department,
              job_title: (twinRes.data as { job_title: string | null }).job_title,
              verified_skills: ((twinRes.data as { verified_skills?: unknown }).verified_skills ?? []) as { name: string; proficiency: number; evidence_source: string; verification_rigor: string }[],
            } as unknown as { verified_skills?: { name: string; proficiency: number; evidence_source: string; verification_rigor: string }[] })
          : null,
        assertions: (assertRes.data ?? []) as { skill_id: string; review_state: string; claimed_proficiency: number }[],
      };
    },
  });

  const skills: PersonSkill[] = useMemo(() => {
    const vs = personData.data?.twin?.verified_skills ?? [];
    const byName = new Map<string, GraphNode>();
    for (const n of graph.data ?? []) byName.set(n.skill.toLowerCase(), n);
    const assertByNode = new Map<string, string>();
    for (const a of personData.data?.assertions ?? []) assertByNode.set(a.skill_id, a.review_state);
    return vs
      .map((v) => {
        const node = byName.get(v.name.toLowerCase());
        return {
          name: v.name,
          proficiency: v.proficiency,
          rigor: v.verification_rigor,
          evidence_source: v.evidence_source,
          category: node?.category ?? "Other",
          nodeId: node?.id ?? null,
          review_state: node ? (assertByNode.get(node.id) ?? null) : null,
        };
      })
      .sort((a, b) => b.proficiency - a.proficiency || a.name.localeCompare(b.name));
  }, [personData.data, graph.data]);

  const skillNameSet = useMemo(() => new Set(skills.map((s) => s.name.toLowerCase())), [skills]);

  const byCategory = useMemo(() => {
    const map = new Map<string, PersonSkill[]>();
    for (const s of skills) map.set(s.category, [...(map.get(s.category) ?? []), s]);
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [skills]);

  const verifiedCount = skills.filter((s) => s.review_state === "reviewer_confirmed" || s.review_state === "assessment_supported" || s.rigor === "high").length;
  const selfReportedCount = skills.filter((s) => s.review_state === "claimed" || s.review_state === "extracted" || s.rigor === "low").length;

  // ---- Searchable taxonomy, person skills highlighted ----
  const taxonomy = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const node of graph.data ?? []) map.set(node.category || "Other", [...(map.get(node.category || "Other") ?? []), node]);
    const q = taxSearch.trim().toLowerCase();
    const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (!q) return rows;
    return rows
      .map(([cat, nodes]) => [cat, nodes.filter((n) => n.skill.toLowerCase().includes(q))] as [string, GraphNode[]])
      .filter(([, nodes]) => nodes.length > 0);
  }, [graph.data, taxSearch]);

  const focusedNode = useMemo(() => graph.data?.find((n) => n.skill === focusedSkill) ?? null, [graph.data, focusedSkill]);

  if (role && !can(role, "explore_skill_graph")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Info className="h-7 w-7 text-muted-foreground" />
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
    role === "employee" ? "Your own skills" : role === "manager" ? "Your team" : role === "recruiter" ? "Authorized candidates" : "Organization";

  // Person-centered network: the person at the center, their skills on a ring,
  // adjacency links between their own skills when the taxonomy connects them.
  const networkSkills = skills.slice(0, 10);
  const networkData = networkSkills.map((s, i) => {
    const angle = (i / networkSkills.length) * 2 * Math.PI - Math.PI / 2;
    return { ...s, x: 160 + Math.cos(angle) * 118, y: 150 + Math.sin(angle) * 110 };
  });
  const links = networkSkills.flatMap((s, i) => {
    const node = graph.data?.find((n) => n.id === s.nodeId);
    if (!node) return [];
    const out = [];
    for (const e of node.outgoing_edges) {
      const j = networkSkills.findIndex((o) => o.name.toLowerCase() === e.target_skill.toLowerCase());
      if (j !== -1) out.push({ from: networkData[i], to: networkData[j], weight: e.weight });
    }
    return out;
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Skill Graph · Person-specific</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">A person's skills, by evidence</h1>
          <p className="max-w-3xl text-muted-foreground">
            Pick a person to see their <b>verified skills</b> — each carries its proficiency, evidence source and verification state.
            The graph is person-centric: no role comparisons, no rankings. {scopeLabel} — enforced server-side.
          </p>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Evidence labels stay honest: "reviewer verified" and "assessment
            supported" are treated as verified; "self-reported" and "extracted" are not.
          </p>
        </div>

        {/* Person selector */}
        <div className="mt-8 flex flex-wrap items-end gap-4">
          <label className="flex min-w-[260px] flex-1 flex-col gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Person
              {role === "employee" ? " (you)" : role === "manager" ? " (your team)" : role === "recruiter" ? " (candidates)" : " (org)"}
            </span>
            <select
              value={twinId}
              onChange={(e) => {
                setTwinId(e.target.value);
                setSearchParams(e.target.value ? { person: e.target.value } : {}, { replace: true });
              }}
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
          {person && (
            <div className="flex flex-wrap items-center gap-2 pb-1 text-sm">
              <span className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                {verifiedCount} verified
              </span>
              {selfReportedCount > 0 && (
                <span className="rounded-md bg-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {selfReportedCount} unverified
                </span>
              )}
              <span className="rounded-md bg-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {skills.length} skills
              </span>
            </div>
          )}
        </div>

        {personData.isLoading && <p className="mt-10 py-10 text-center text-sm text-muted-foreground">Loading {person?.name?.split(" ")[0] ?? "this person"}'s skills…</p>}

        {person && skills.length > 0 && (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Skills by category */}
            <section aria-label="Skills by category" className="lg:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-foreground">{person.name}'s skills</h2>
                  <p className="text-xs text-muted-foreground">
                    {person.job_title ?? ""}
                    {person.department ? ` · ${person.department}` : ""} · {person.role.replace(/_/g, " ")}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-4">
                {byCategory.map(([category, items]) => (
                  <div key={category} className="rounded-lg bg-white p-4 shadow-card">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{category}</p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{items.length}</span>
                    </div>
                    <ul className="mt-2 flex flex-col gap-2">
                      {items.map((s) => (
                        <li key={s.name} className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setFocusedSkill(focusedSkill === s.name ? null : s.name)}
                            className="min-w-0 flex-1 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Focus skill ${s.name}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-foreground">{s.name}</span>
                              {s.review_state && STATE_CHIP[s.review_state] && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATE_CHIP[s.review_state].cls}`}>
                                  {STATE_CHIP[s.review_state].label}
                                </span>
                              )}
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${RIGOR_CHIP[s.rigor] ?? RIGOR_CHIP.low}`}>
                                {s.rigor} rigor
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted">
                                <div className="h-full bg-primary" style={{ width: `${(s.proficiency / 5) * 100}%` }} />
                              </div>
                              <span className="w-6 text-right text-[11px] font-bold text-muted-foreground">{s.proficiency}/5</span>
                            </div>
                          </button>
                          <span className="text-[10px] text-muted-foreground">{s.evidence_source.replace(/_/g, " ")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* Person-centered network */}
            <section aria-label="Skill network" className="lg:col-span-1">
              <div className="rounded-lg bg-white p-4 shadow-card">
                <h3 className="text-sm font-extrabold text-foreground">Skill network</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {person.name.split(" ")[0]}'s strongest skills and the adjacency links between them.
                </p>
                {networkSkills.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No verified skills to map.</p>
                ) : (
                  <svg viewBox="0 0 320 300" className="mt-3 w-full" role="img" aria-label={`Skill network centered on ${person.name}`}>
                    {links.map((l, i) => (
                      <line
                        key={`l${i}`}
                        x1={l.from.x}
                        y1={l.from.y}
                        x2={l.to.x}
                        y2={l.to.y}
                        stroke="hsl(var(--border))"
                        strokeWidth={Math.max(1, Math.round(l.weight * 2.5))}
                      />
                    ))}
                    {networkData.map((s) => (
                      <g key={s.name}>
                        <circle cx={s.x} cy={s.y} r={26} fill={s.review_state === "reviewer_confirmed" || s.rigor === "high" ? "hsl(var(--primary))" : "hsl(var(--muted))"} opacity={0.15} />
                        <circle cx={s.x} cy={s.y} r={18} fill={s.review_state === "reviewer_confirmed" || s.rigor === "high" ? "hsl(var(--primary))" : "hsl(var(--muted))"} />
                        <text x={s.x} y={s.y + 3} textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
                          {s.name.length > 11 ? `${s.name.slice(0, 10)}…` : s.name}
                        </text>
                      </g>
                    ))}
                    <circle cx="160" cy="150" r="30" fill="hsl(var(--canvas))" stroke="hsl(var(--border))" />
                    <text x="160" y="148" textAnchor="middle" fontSize="10" fontWeight="800" fill="hsl(var(--foreground))">
                      {person.name.split(" ")[0]}
                    </text>
                    <text x="160" y="161" textAnchor="middle" fontSize="7" fill="hsl(var(--muted-foreground))">
                      {skills.length} skills
                    </text>
                  </svg>
                )}
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" />
                  Blue nodes are verified by a reviewer or assessment; grey are lower-rigor evidence.
                </p>
              </div>

              {focusedSkill && focusedNode && (
                <div className="mt-4 rounded-lg bg-white p-4 shadow-card">
                  <p className="text-sm font-extrabold text-foreground">{focusedNode.skill}</p>
                  <p className="text-xs text-muted-foreground">{focusedNode.category}</p>
                  <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                    <p>
                      <span className="font-bold text-foreground">{skillNameSet.has(focusedNode.skill.toLowerCase()) ? "Part of this person's profile" : "Not in this person's profile"}</span>
                      {skillNameSet.has(focusedNode.skill.toLowerCase()) && skills.find((s) => s.name === focusedNode.skill) ? (
                        <span> · proficiency {skills.find((s) => s.name === focusedNode.skill)!.proficiency}/5</span>
                      ) : null}
                    </p>
                    {focusedNode.outgoing_edges.length > 0 && (
                      <p>Adjacent to: {focusedNode.outgoing_edges.map((e) => e.target_skill).join(", ")}</p>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {person && skills.length === 0 && !personData.isLoading && (
          <div className="mt-10 rounded-lg bg-white p-10 text-center shadow-card">
            <p className="text-sm font-bold text-foreground">No verified skills on record for {person.name}.</p>
            <p className="mt-1 text-xs text-muted-foreground">Skills appear here as verified evidence is accepted.</p>
          </div>
        )}

        {/* Taxonomy with this person's skills highlighted */}
        <section aria-label="Skill taxonomy" className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-foreground">Skill taxonomy</h2>
              <p className="text-xs text-muted-foreground">
                The organization's skill catalog. Skills {person ? `${person.name.split(" ")[0]} has ` : "the selected person has "}are marked.
              </p>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={taxSearch}
                onChange={(e) => setTaxSearch(e.target.value)}
                placeholder="Search skills…"
                className="h-9 w-52 rounded-md border border-input bg-white pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Search the skill taxonomy"
              />
            </div>
          </div>

          {taxonomy.length === 0 ? (
            <p className="mt-6 rounded-lg bg-white p-8 text-center text-sm text-muted-foreground shadow-card">No skills match your search.</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {taxonomy.map(([category, nodes]) => {
                const owned = nodes.filter((n) => skillNameSet.has(n.skill.toLowerCase()));
                return (
                  <div key={category} className="rounded-lg bg-white p-4 shadow-card">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{category}</p>
                      {owned.length > 0 && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{owned.length} owned</span>
                      )}
                    </div>
                    <ul className="mt-2 flex flex-col">
                      {nodes.slice(0, 10).map((n) => {
                        const has = skillNameSet.has(n.skill.toLowerCase());
                        const mine = skills.find((s) => s.name === n.skill);
                        return (
                          <li key={n.id}>
                            <button
                              type="button"
                              onClick={() => setFocusedSkill(focusedSkill === n.skill ? null : n.skill)}
                              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${has ? "bg-primary/5 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                            >
                              <span>{n.skill}</span>
                              {has && mine ? (
                                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-extrabold text-white">{mine.proficiency}</span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                      {nodes.length > 10 && (
                        <p className="px-2 py-1 text-[11px] text-muted-foreground">+{nodes.length - 10} more in {category}</p>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
