import { useMemo, useState } from "react";
import { ArrowUpDown, Loader2, Scale, ShieldAlert, Target, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { classifyQuery } from "@/lib/query-state";
import type { CandidateCompare, CandidateCompareRow } from "@/lib/contracts";

const STAGE_LABEL: Record<string, string> = {
  screening: "Under Review",
  technical_interview: "Interview Scheduled",
  final_round: "Decision Pending",
  selected: "Offer Extended",
  rejected: "Not moving forward",
};

function StatusBadge({ status }: { status: CandidateCompareRow["status"] }) {
  if (status === "scored") return <span className="rounded-md bg-secondary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary">Scored</span>;
  if (status === "stale") return <span className="rounded-md bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">Stale</span>;
  return <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Unscored</span>;
}

function GateChip({ row }: { row: CandidateCompareRow }) {
  if (row.gate_met === null) return <span className="text-[11px] text-muted-foreground">—</span>;
  if (row.gate_met) return <span className="rounded-md bg-secondary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary">Gate met</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
      <ShieldAlert className="h-3 w-3" /> Gate not met
    </span>
  );
}

function CoverageCell({ met, total }: { met: number; total: number }) {
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;
  return (
    <div className="flex w-20 flex-col">
      <span className="font-bold text-foreground">
        {met}<span className="text-muted-foreground">/{total}</span>
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <span className="block h-full bg-foreground" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function RankCell({ row }: { row: CandidateCompareRow }) {
  if (row.rank_tier === "ranked") {
    const pct = Math.round((row.rank ?? 0) * 100);
    const tone = pct >= 70 ? "text-secondary" : pct >= 45 ? "text-foreground" : "text-accent";
    return (
      <div className="flex flex-col">
        <span className={`font-mono text-base font-extrabold ${tone}`}>{pct}<span className="text-xs opacity-60">/100</span></span>
        <span className="text-[10px] text-muted-foreground">explainable rank</span>
        {row.tie_reason && <span className="mt-0.5 max-w-[220px] text-[10px] leading-snug text-muted-foreground" title={row.tie_reason}>tie: {row.tie_reason}</span>}
      </div>
    );
  }
  const label =
    row.rank_tier === "gated" ? "Gated — mandatory unmet" :
    row.rank_tier === "insufficient" ? "Insufficient evidence" :
    row.status === "scored" ? "Not ranked" : "Unscored";
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${row.rank_tier === "gated" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{label}</span>;
}

function ConfidenceCell({ row }: { row: CandidateCompareRow }) {
  if (row.evidence_confidence === null) return <span className="text-[11px] text-muted-foreground">—</span>;
  const pct = Math.round(row.evidence_confidence * 100);
  const tone = pct >= 70 ? "text-secondary" : pct >= 45 ? "text-foreground" : "text-accent";
  return <span className={`font-bold ${tone}`}>{pct}%</span>;
}

interface Props {
  compare: CandidateCompare;
  state: ReturnType<typeof classifyQuery<CandidateCompare>>;
  onOpenCandidate: (twinId: string) => void;
  onShowFit: (twinId: string) => void;
  /** Future capability signals for the criteria strip (required_skills diff). */
  futureSignals?: { skill: string; target_proficiency: number }[];
}

export function CandidateCompareTable({ compare, state, onOpenCandidate, onShowFit, futureSignals = [] }: Props) {
  const [showFairness, setShowFairness] = useState(false);
  const rankWeightRows = useMemo(
    () =>
      (Object.entries(compare.rank_weights ?? {}) as [string, number][])
        .map(([k, w]) => ({ key: k, weight: w, label: k === "work_sample" ? "work sample" : k.replace("_", " ") }))
        .sort((a, b) => b.weight - a.weight),
    [compare.rank_weights]
  );
  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Computing comparison…
      </div>
    );
  }
  if (state.kind === "error" || state.kind === "unavailable") {
    return (
      <div className="rounded-lg bg-destructive/10 p-6 text-sm text-destructive">
        {state.kind === "unavailable" ? "Could not reach the backend — check your connection and try again." : state.message}
      </div>
    );
  }
  if (state.kind === "forbidden") {
    return <div className="rounded-lg bg-destructive/10 p-6 text-sm text-destructive">Comparison is restricted to recruitment-authorized roles.</div>;
  }
  if (state.kind === "empty" || compare.rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg bg-muted px-6 py-14 text-center text-sm text-muted-foreground">
        <UserRound className="h-7 w-7 text-primary" />
        No active applicants to compare yet.
      </div>
    );
  }

  const mandatory = compare.criteria.filter((c) => c.requirement === "required");
  const preferred = compare.criteria.filter((c) => c.requirement === "preferred");
  const groups: { key: string; label: string; hint: string; rows: CandidateCompareRow[] }[] = [
    { key: "scored", label: "Scored & ranked", hint: "explainable rank over known evidence components", rows: compare.rows.filter((r) => r.status === "scored" && r.rank_tier === "ranked") },
    { key: "gated", label: "Gated / insufficient", hint: "mandatory gate unmet or no requirement-level evidence", rows: compare.rows.filter((r) => r.status === "scored" && (r.rank_tier === "gated" || r.rank_tier === "insufficient")) },
    { key: "unscored", label: "Unscored", hint: "no match computed — run the Fit card first", rows: compare.rows.filter((r) => r.status === "unscored") },
    { key: "stale", label: "Stale", hint: "criteria changed after the last match", rows: compare.rows.filter((r) => r.status === "stale") },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Evidence funnel criteria: Mandatory / Preferred / Future signals */}
      <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
        <p className="font-bold uppercase tracking-wider text-foreground">Evidence funnel criteria</p>
        <div className="mt-2 flex flex-col gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Mandatory hiring criteria (normalized within this section)</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {mandatory.length === 0 && <span className="text-xs italic">none defined</span>}
              {mandatory.map((c) => (
                <span key={c.skill} title={c.evidence_expectation} className="rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {c.skill} · {c.target_proficiency} · w{c.weight}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent">Preferred differentiators</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {preferred.length === 0 && <span className="text-xs italic">none defined</span>}
              {preferred.map((c) => (
                <span key={c.skill} title={c.evidence_expectation} className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                  {c.skill} · {c.target_proficiency} · w{c.weight}
                </span>
              ))}
            </div>
          </div>
          {futureSignals.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">Future capability signals (not required today)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {futureSignals.map((s) => (
                  <span key={s.skill} className="rounded-md bg-secondary/15 px-2 py-0.5 text-[11px] font-semibold text-secondary">
                    {s.skill} · {s.target_proficiency}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ranking policy + fairness */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="font-bold uppercase tracking-wider text-foreground">Ranking policy</span>
          {rankWeightRows.map((r) => (
            <span key={r.key} className="font-semibold text-foreground">
              {r.label} <span className="text-primary">{Math.round(r.weight * 100)}%</span>
            </span>
          ))}
          <span className="text-[11px]">weights renormalize over known components — unknown is never 0</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowFairness((v) => !v)}>
          <Scale className="h-3.5 w-3.5" /> {showFairness ? "Hide" : "Show"} fairness & audit
        </Button>
      </div>
      {showFairness && compare.fairness && (
        <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 text-xs text-foreground">
          <p className="flex items-center gap-1.5 font-extrabold uppercase tracking-wider text-primary">
            <Scale className="h-3.5 w-3.5" /> Fairness & audit — what ranking never reads
          </p>
          <p className="mt-1.5 leading-relaxed text-muted-foreground">{compare.fairness.statement}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {(compare.fairness.excluded_attributes ?? []).map((a) => (
              <li key={a} className="rounded-md bg-muted px-2 py-0.5 font-semibold text-foreground">{a}</li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">{g.label}</h3>
            <span className="text-[11px] text-muted-foreground">({g.rows.length} · {g.hint})</span>
          </div>
          <div className="overflow-x-auto rounded-lg border-2 border-border bg-white">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[22%]">Candidate</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Gate</TableHead>
                  <TableHead className="hidden lg:table-cell">Verified cov.</TableHead>
                  <TableHead className="hidden lg:table-cell">Provisional cov.</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead className="hidden md:table-cell">Assessment</TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpDown className="h-3 w-3" /> Rank
                    </span>
                  </TableHead>
                  <TableHead className="hidden xl:table-cell">Gaps / transferable</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.rows.map((row) => (
                  <TableRow key={row.twin_id} className="cursor-pointer" onClick={() => onOpenCandidate(row.twin_id)}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold text-foreground">{row.name}</span>
                        <span className="text-[11px] text-muted-foreground">{row.application_code}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-foreground">{STAGE_LABEL[row.stage] ?? row.stage.replace(/_/g, " ")}</span>
                        <StatusBadge status={row.status} />
                      </div>
                    </TableCell>
                    <TableCell><GateChip row={row} /></TableCell>
                    <TableCell className="hidden lg:table-cell"><CoverageCell met={row.verified_coverage.met} total={row.verified_coverage.total} /></TableCell>
                    <TableCell className="hidden lg:table-cell"><CoverageCell met={row.provisional_coverage.met} total={row.provisional_coverage.total} /></TableCell>
                    <TableCell><ConfidenceCell row={row} /></TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                        <span>work sample: {row.work_sample !== null ? `${Math.round(row.work_sample * 100)}%${row.work_sample_reviewed ? " · reviewed" : ""}` : "—"}</span>
                        <span>interview: {row.interview_score !== null ? `${Math.round(row.interview_score * 100)}%` : row.interview_status === "scheduled" ? "scheduled" : "—"}</span>
                        {row.assessment_submitted && <span className="font-semibold text-foreground">submitted</span>}
                      </div>
                    </TableCell>
                    <TableCell><RankCell row={row} /></TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {row.gaps.slice(0, 2).map((g) => (
                          <span key={g} className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">gap: {g}</span>
                        ))}
                        {row.transferable.slice(0, 1).map((g) => (
                          <span key={g} className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">transferable: {g}</span>
                        ))}
                        {row.gaps.length === 0 && row.transferable.length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onShowFit(row.twin_id);
                        }}
                      >
                        <Target className="h-3.5 w-3.5" /> Fit card
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}
