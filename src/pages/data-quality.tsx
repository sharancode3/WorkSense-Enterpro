import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { can } from "@/lib/rbac";
import { AlertTriangle, CheckCircle2, Database, FileText, Loader2, Lock, ShieldCheck, Users } from "lucide-react";

interface AssertionRow {
  review_state: string;
  claimed_proficiency: number;
  evidence_ids: string[];
}

export default function DataQuality() {
  const { role, twin } = useAuth();

  const report = useQuery({
    queryKey: ["data-quality", twin?.id ?? "anon"],
    queryFn: async () => {
      const [twinsRes, assertionsRes, evidenceRes] = await Promise.all([
        supabase.from("digital_twins").select("id, role, status, verified_skills").eq("role", "employee").eq("status", "active"),
        supabase.from("skill_assertions").select("review_state, claimed_proficiency, evidence_ids"),
        supabase.from("evidence_items").select("id, quote").not("quote", "is", null),
      ]);
      const twins = (twinsRes.data ?? []) as { id: string; verified_skills: unknown[] }[];
      const assertions = (assertionsRes.data ?? []) as AssertionRow[];
      const evidence = (evidenceRes.data ?? []) as { id: string; quote: string | null }[];
      const rigor = (s: string) => (s === "reviewer_confirmed" ? "high" : s === "assessment_supported" ? "medium" : "low");
      const rigorDist = { high: 0, medium: 0, low: 0 };
      const orphans: string[] = [];
      for (const a of assertions) {
        rigorDist[rigor(a.review_state)] += 1;
        if (!a.evidence_ids || a.evidence_ids.length === 0) orphans.push(a.review_state);
      }
      const noSkills = twins.filter((t) => !Array.isArray(t.verified_skills) || t.verified_skills.length === 0).length;
      const thinSkills = twins.filter((t) => (t.verified_skills ?? []).length < 2).length;
      const withQuotes = evidence.filter((e) => e.quote && e.quote.trim().length > 0).length;
      return {
        twins: twins.length,
        noSkills,
        thinSkills,
        assertions: assertions.length,
        rigorDist,
        orphans: orphans.length,
        evidenceWithQuotes: withQuotes,
      };
    },
  });

  if (role && !can(role, "manage_users") && !can(role, "view_all_workforce")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Data quality access only</h1>
          <p className="text-muted-foreground">The data quality engine is restricted to workforce administrators.</p>
        </div>
      </AppShell>
    );
  }

  const d = report.data;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Platform operations · read-only</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">Data quality engine</h1>
          <p className="max-w-2xl text-muted-foreground">
            Health of the evidence ledger: assertion rigor distribution, orphaned claims, and twins with missing or
            thin skill records. Aggregated deterministically from live records — fictional demo data.
          </p>
        </div>

        {report.isLoading && (
          <div className="mt-8 flex items-center gap-3 rounded-lg bg-muted p-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> Aggregating the evidence ledger…
          </div>
        )}
        {report.error && (
          <div className="mt-8 rounded-lg bg-destructive/10 p-6 text-sm text-destructive">
            Data quality unavailable: {report.error instanceof Error ? report.error.message : "unknown error"}
          </div>
        )}

        {d && (
          <>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Active employees
                </p>
                <p className="mt-2 text-2xl font-extrabold text-foreground">{d.twins}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.noSkills} with no verified skills · {d.thinSkills} with fewer than 2</p>
              </div>
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <Database className="h-3.5 w-3.5" /> Skill claims
                </p>
                <p className="mt-2 text-2xl font-extrabold text-foreground">{d.assertions}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.orphans} orphaned (no evidence link)</p>
              </div>
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" /> Rigor distribution
                </p>
                <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-secondary" style={{ width: `${(d.rigorDist.high / Math.max(1, d.assertions)) * 100}%` }} title="high" />
                  <div className="h-full bg-primary" style={{ width: `${(d.rigorDist.medium / Math.max(1, d.assertions)) * 100}%` }} title="medium" />
                  <div className="h-full bg-accent" style={{ width: `${(d.rigorDist.low / Math.max(1, d.assertions)) * 100}%` }} title="low" />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  high {d.rigorDist.high} · medium {d.rigorDist.medium} · low {d.rigorDist.low}
                </p>
              </div>
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" /> Evidence with quotes
                </p>
                <p className="mt-2 text-2xl font-extrabold text-foreground">{d.evidenceWithQuotes}</p>
                <p className="mt-1 text-xs text-muted-foreground">source-attributable evidence items</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 rounded-lg bg-muted p-5 text-sm text-foreground">
              <p className="flex items-start gap-2">
                {d.orphans > 0 ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                )}
                <span>
                  <b>{d.orphans > 0 ? "Attention:" : "Healthy:"}</b> {d.orphans > 0
                    ? `${d.orphans} skill claims carry no linked evidence — they stay claims (low rigor) until evidence is attached or the claim is resolved.`
                    : "every skill claim in scope is linked to at least one evidence item."}
                </span>
              </p>
              <p className="flex items-start gap-2 text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Resume-extracted claims are intentionally low-rigor until a work sample or reviewer confirms them.
                  This page reports the distribution — it never promotes a claim to verified.
                </span>
              </p>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
