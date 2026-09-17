import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { FitCard } from "@/components/fit-card";
import { computeSkillFit, type FitRecord, type GraphNode } from "@/lib/skill-graph";
import { can } from "@/lib/rbac";
import { Button } from "@/components/ui/button";

interface TwinOption {
  id: string;
  name: string;
  role: string;
  department: string | null;
}

export default function SkillGraph() {
  const { role, user } = useAuth();
  const [twinId, setTwinId] = useState("");
  const [reqId, setReqId] = useState("");
  const [current, setCurrent] = useState<FitRecord | null>(null);
  const [future, setFuture] = useState<FitRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const twins = useQuery({
    queryKey: ["graph-twins", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("digital_twins")
        .select("id, name, role, department")
        .order("name");
      return (data ?? []) as TwinOption[];
    },
  });

  const reqs = useQuery({
    queryKey: ["graph-reqs", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_requisitions")
        .select("id, title, department, required_skills, future_skills")
        .order("title");
      return (data ?? []) as { id: string; title: string; department: string; required_skills: unknown[]; future_skills: unknown[] }[];
    },
  });

  const graph = useQuery({
    queryKey: ["graph-nodes", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase.from("skill_graph").select("id, skill, category, outgoing_edges");
      return (data ?? []) as GraphNode[];
    },
  });

  const categories = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const node of graph.data ?? []) {
      map.set(node.category || "Other", [...(map.get(node.category || "Other") ?? []), node]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [graph.data]);

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
          <h1 className="text-2xl font-extrabold text-foreground">HR Executives only</h1>
          <p className="text-muted-foreground">
            The Skill Intelligence Graph Explorer is restricted to the HR Executive role — enforced at the data layer, not just in the UI.
          </p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Skill Intelligence Graph</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Coverage against current <span className="text-primary">and</span> future requirements
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Pick a DigitalTwin and a requisition. The engine scores the match against today's required
            skills and the 12–24 month outlook, persists the result to the twin's record, and audits it.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">DigitalTwin</span>
            <select
              value={twinId}
              onChange={(e) => setTwinId(e.target.value)}
              className="h-12 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
            >
              <option value="">Select a person…</option>
              {(twins.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.role.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Requisition</span>
            <select
              value={reqId}
              onChange={(e) => setReqId(e.target.value)}
              className="h-12 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
            >
              <option value="">Select a role…</option>
              {(reqs.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.department}
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
          <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <FitCard fit={current} />
            <FitCard fit={future} />
          </div>
        )}

        {!current && (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-16 text-center">
            <Share2 className="h-8 w-8 text-primary" strokeWidth={2.5} />
            <p className="text-sm text-muted-foreground">
              Select a person and a role to see their coverage against current and future skills.
            </p>
          </div>
        )}

        {/* Graph browser */}
        <div className="mt-16">
          <h2 className="text-xl font-extrabold tracking-tight text-foreground">Browse the Skill Graph</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Typed edges — ADJACENT_TO, TRANSFERABLE_TO, PREREQUISITE_OF. No direct-equivalence edges.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {categories.map(([category, nodes]) => (
              <div key={category} className="rounded-lg bg-muted p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{category}</h3>
                <div className="mt-3 flex flex-col gap-2">
                  {nodes.map((node) => (
                    <GraphNodeCard key={node.id} node={node} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function GraphNodeCard({ node }: { node: GraphNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md bg-white transition-all duration-200 hover:scale-[1.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-sm font-bold text-foreground">{node.skill}</span>
        <span className="text-xs text-muted-foreground">{node.outgoing_edges.length} edge{node.outgoing_edges.length === 1 ? "" : "s"}</span>
      </button>
      {open && node.outgoing_edges.length > 0 && (
        <ul className="flex flex-col gap-1 border-t-2 border-border px-3 py-2">
          {node.outgoing_edges.map((e) => (
            <li key={`${node.skill}-${e.target_skill}-${e.type}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-foreground">
                {node.skill} → {e.target_skill}
              </span>
              <span className={`rounded px-1.5 py-0.5 font-mono ${e.type === "PREREQUISITE_OF" ? "bg-accent text-foreground" : "bg-primary/15 text-primary"}`}>
                {e.type} {e.weight.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
