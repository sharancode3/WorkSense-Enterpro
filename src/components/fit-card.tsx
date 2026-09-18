import { ArrowLeftRight, BadgeCheck, FileText, Info, RefreshCw, XCircle } from "lucide-react";
import { fitBand, type EvidenceItem, type FitItem, type FitLineage, type FitRecord } from "@/lib/skill-graph";

const CLASS_META: Record<
  FitItem["classification"],
  { label: string; icon: typeof BadgeCheck; chip: string; iconClass: string }
> = {
  direct: { label: "Direct", icon: BadgeCheck, chip: "bg-primary text-white", iconClass: "text-white" },
  adjacent: { label: "Adjacent", icon: ArrowLeftRight, chip: "bg-muted text-foreground", iconClass: "text-primary/70" },
  transferable: { label: "Transferable", icon: RefreshCw, chip: "bg-muted text-foreground", iconClass: "text-secondary/80" },
  gap: { label: "Gap", icon: XCircle, chip: "bg-muted text-foreground", iconClass: "text-muted-foreground" },
};

const STATE_META: Record<string, { label: string; chip: string }> = {
  reviewer_confirmed: { label: "Reviewer confirmed", chip: "bg-primary text-white" },
  assessment_supported: { label: "Assessment supported", chip: "bg-secondary text-white" },
  extracted: { label: "Extracted (unverified)", chip: "bg-muted text-foreground" },
  claimed: { label: "Self-reported", chip: "bg-muted text-foreground" },
  expired: { label: "Expired", chip: "bg-muted text-muted-foreground" },
  disputed: { label: "Disputed", chip: "bg-muted text-muted-foreground" },
  superseded: { label: "Superseded", chip: "bg-muted text-muted-foreground" },
};

const stateMeta = (state: string) =>
  STATE_META[state] ?? { label: state.split("_").join(" "), chip: "bg-muted text-foreground" };

const pct = (n: number) => `${Math.round(n * 100)}`;

function ScoreBlock({ fit }: { fit: FitRecord }) {
  const band = fitBand(fit.score);
  const block = { high: "bg-primary text-white", mid: "bg-secondary text-white", low: "bg-accent text-foreground" }[band];
  return (
    <div className={`flex items-center justify-between rounded-lg p-5 ${block}`}>
      <div>
        <p className={`text-xs font-bold uppercase tracking-wider ${band === "low" ? "text-foreground/60" : "text-white/75"}`}>
          Overall match
        </p>
        <p className="mt-1 text-4xl font-extrabold tracking-tight">{pct(fit.score)}<span className="text-lg font-bold opacity-70">/100</span></p>
      </div>
      <span className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${band === "low" ? "bg-foreground text-white" : "bg-white/20 text-white"}`}>
        {fit.scenario === "future" ? "12–24 mo outlook" : "current"}
      </span>
    </div>
  );
}

function SectionBar({ label, value, detail, weightLabel }: { label: string; value: number; detail: string; weightLabel: string }) {
  return (
    <div className="rounded-lg bg-muted p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-lg font-extrabold text-foreground">{pct(value)}<span className="text-xs font-semibold text-muted-foreground">% of this section</span></span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
        <div className="h-full bg-foreground" style={{ width: `${value * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      <p className="mt-1 text-[11px] font-semibold text-primary">{weightLabel}</p>
    </div>
  );
}

function ItemRow({ item }: { item: FitItem }) {
  const meta = CLASS_META[item.classification];
  const Icon = meta.icon;
  const isPartialDirect = item.classification === "direct" && item.candidate_proficiency !== null && item.candidate_proficiency < item.required_proficiency;

  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${isPartialDirect ? "bg-primary/15 text-primary" : meta.chip}`}>
          <Icon className={`h-3.5 w-3.5 ${isPartialDirect ? "text-primary/70" : meta.iconClass}`} strokeWidth={2.5} />
          {meta.label}
        </span>
        <span className="text-sm font-bold text-foreground">{item.skill}</span>
        <span className="text-xs text-muted-foreground">
          req {item.required_proficiency}
          {item.candidate_proficiency !== null && ` · holds ${item.candidate_proficiency}`}
        </span>
        {item.contribution !== null && item.classification !== "transferable" && (
          <span className="ml-auto text-xs font-semibold text-muted-foreground">
            section contribution {item.contribution.toFixed(2)} (0–1)
          </span>
        )}
      </div>
      {item.edge && (
        <span className="inline-flex w-fit items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
          {item.edge.from_skill} → {item.skill}
          <span className="text-muted-foreground">· {item.edge.type} weight {item.edge.weight.toFixed(2)}</span>
        </span>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{item.reason}</p>
      {item.limitation && (
        <p className="flex items-start gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-800">
          <Info className="mt-0.5 h-3 w-3 shrink-0" /> {item.limitation}
        </p>
      )}
    </li>
  );
}

function ItemGroup({ title, items, hint }: { title: string; items: FitItem[]; hint?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="border-t-2 border-border pt-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <ul className="divide-y divide-border">{items.map((item) => <ItemRow key={`${item.skill}-${item.classification}`} item={item} />)}</ul>
    </div>
  );
}

function EvidenceLineagePanel({ lineage }: { lineage: FitLineage }) {
  const byId = new Map(lineage.evidence.map((e) => [e.id, e]));
  return (
    <div className="border-t-2 border-border pt-3">
      <div className="flex items-baseline justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <FileText className="h-3.5 w-3.5" /> Evidence lineage
        </h4>
        <span className="text-xs text-muted-foreground">fit → assertion → evidence</span>
      </div>
      {lineage.assertions.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No skill assertions recorded for this person yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {lineage.assertions.map((a) => {
            const meta = stateMeta(a.review_state);
            const evidence = (a.evidence_ids ?? []).map((id) => byId.get(id)).filter((e): e is EvidenceItem => Boolean(e));
            return (
              <li key={a.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{a.skill_name}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${meta.chip}`}>{meta.label}</span>
                  <span className="text-xs text-muted-foreground">level {a.claimed_proficiency}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{evidence.length} evidence</span>
                </div>
                {evidence.map((e) => (
                  <div key={e.id} className="mt-1.5 rounded-md bg-muted px-3 py-2">
                    <p className="font-mono text-xs leading-relaxed text-foreground/80">“{e.quote}”</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {e.source_type.split("_").join(" ")} · {e.source_id ?? "no source id"} · {new Date(e.captured_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
                {evidence.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">No linked evidence item.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The reusable FIT card — used unmodified by Recruitment, Onboarding, the
 * Recommendation Hub and the Skill Graph Explorer. Pass `lineage` (from the
 * skill-match response) to render the evidence lineage panel.
 */
export function FitCard({ fit, lineage }: { fit: FitRecord; lineage?: FitLineage }) {
  const { sections } = fit;
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-white p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-extrabold tracking-tight text-foreground">{fit.target_title}</h3>
          <p className="text-xs text-muted-foreground">
            {fit.scenario === "future" ? "Future (12–24 month) requirements" : "Current requirements"} · computed {new Date(fit.computed_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      <ScoreBlock fit={fit} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SectionBar label="Direct" value={sections.direct.value} detail={`${sections.direct.items.length} owned skill(s)`} weightLabel="weighted 50% of total score" />
        <SectionBar label="Adjacent" value={sections.adjacent.value} detail={`${sections.adjacent.items.length} adjacent path(s) — not direct`} weightLabel="weighted 25% of total score" />
        <SectionBar label="Evidence" value={sections.evidence.value} detail={`${sections.evidence.artifact_count}/${sections.evidence.threshold} independent artifacts`} weightLabel="weighted 15% of total score" />
        <SectionBar label="Seniority" value={sections.seniority.value} detail={`Level ${sections.seniority.candidate_level} vs ${sections.seniority.role_level}`} weightLabel="weighted 10% of total score" />
      </div>

      <p className="rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mr-1 inline h-3 w-3" />
        Score components are 0–1 ratios, each multiplied by its fixed weight (50 / 25 / 15 / 10%) and summed to the
        0–100 match percentage shown above. Adjacent paths are weighted support, never direct equivalence.
      </p>

      <div className="flex flex-col gap-4">
        <ItemGroup title="Direct skills" items={fit.classification.direct} />
        <ItemGroup title="Adjacent skills" items={fit.classification.adjacent} hint="backed by a graph edge" />
        <ItemGroup title="Transferable skills" items={fit.classification.transferable} hint="no points — development signal only" />
        <ItemGroup title="Gaps" items={fit.classification.gaps} />
      </div>

      {(fit.assumptions || fit.versions) && (
        <div className="rounded-md bg-accent/50 p-3 text-xs text-foreground">
          <p className="font-extrabold uppercase tracking-wider">Computation & assumptions</p>
          {fit.assumptions && (
            <>
              <p className="mt-1">
                <b>Horizon:</b> {fit.assumptions.horizon}.
              </p>
              <p className="text-muted-foreground">{fit.assumptions.note}</p>
            </>
          )}
          {fit.versions && (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              engine v{fit.versions.engine} · evidence {fit.versions.evidence.slice(0, 8)} · requisition {fit.versions.requisition.slice(0, 8)} · computed {new Date(fit.computed_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {lineage && <EvidenceLineagePanel lineage={lineage} />}
    </div>
  );
}
