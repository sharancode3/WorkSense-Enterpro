import { ArrowUpDown, Loader2, Target, UserRound } from "lucide-react";
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

function ScoreCell({ row }: { row: CandidateCompareRow }) {
  if (row.status === "unscored") {
    return (
      <div className="flex flex-col">
        <span className="font-mono text-sm font-bold text-muted-foreground">—</span>
        <span className="text-[11px] text-muted-foreground">no match computed yet</span>
      </div>
    );
  }
  const score = Math.round((row.score ?? 0) * 100);
  return (
    <div className="flex flex-col">
      <span className={`font-mono text-sm font-bold ${row.status === "stale" ? "text-accent" : "text-foreground"}`}>
        {score}/100
      </span>
      <span className="text-[11px] text-muted-foreground">
        {row.status === "stale" ? "criteria changed after this score" : new Date(row.score_at ?? Date.now()).toLocaleDateString()}
      </span>
    </div>
  );
}

interface Props {
  compare: CandidateCompare;
  state: ReturnType<typeof classifyQuery<CandidateCompare>>;
  onOpenCandidate: (twinId: string) => void;
  onShowFit: (twinId: string) => void;
}

export function CandidateCompareTable({ compare, state, onOpenCandidate, onShowFit }: Props) {
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

  const groups: { key: string; label: string; hint: string; rows: CandidateCompareRow[] }[] = [
    { key: "scored", label: "Scored", hint: "deterministic match vs current criteria", rows: compare.rows.filter((r) => r.status === "scored") },
    { key: "unscored", label: "Unscored", hint: "no match computed — run the Fit card first", rows: compare.rows.filter((r) => r.status === "unscored") },
    { key: "stale", label: "Stale", hint: "criteria changed after the last match", rows: compare.rows.filter((r) => r.status === "stale") },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {compare.criteria.length > 0 && (
        <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          <span className="font-bold uppercase tracking-wider text-foreground">Criteria</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {compare.criteria.map((c) => (
              <span
                key={c.skill}
                title={c.evidence_expectation}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${c.requirement === "required" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {c.skill} · {c.target_proficiency} · w {c.weight}
                <span className="ml-1 lowercase">{c.requirement}</span>
              </span>
            ))}
          </div>
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
                  <TableHead className="w-[26%]">Candidate</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="w-[16%]">
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpDown className="h-3 w-3" /> Match
                    </span>
                  </TableHead>
                  <TableHead className="hidden md:table-cell">Gaps / strengths</TableHead>
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
                    <TableCell>
                      <ScoreCell row={row} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex max-w-[240px] flex-wrap gap-1">
                        {row.gaps.slice(0, 2).map((g) => (
                          <span key={g} className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                            gap: {g}
                          </span>
                        ))}
                        {row.transferable.slice(0, 1).map((g) => (
                          <span key={g} className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                            transferable: {g}
                          </span>
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
