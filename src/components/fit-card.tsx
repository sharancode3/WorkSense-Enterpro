import { ArrowLeftRight, BadgeCheck, RefreshCw, XCircle } from "lucide-react";
import { fitBand, type FitItem, type FitRecord } from "@/lib/skill-graph";

const CLASS_META: Record<
  FitItem["classification"],
  { label: string; icon: typeof BadgeCheck; chip: string; iconClass: string }
> = {
  direct: { label: "Direct", icon: BadgeCheck, chip: "bg-primary text-white", iconClass: "text-white" },
  adjacent: { label: "Adjacent", icon: ArrowLeftRight, chip: "bg-muted text-foreground", iconClass: "text-primary/70" },
  transferable: { label: "Transferable", icon: RefreshCw, chip: "bg-muted text-foreground", iconClass: "text-secondary/80" },
  gap: { label: "Gap", icon: XCircle, chip: "bg-muted text-foreground", iconClass: "text-muted-foreground" },
};

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

function SectionBar({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-lg bg-muted p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-lg font-extrabold text-foreground">{pct(value)}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
        <div className="h-full bg-foreground" style={{ width: `${value * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
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
        {item.contribution !== null && (
          <span className="ml-auto text-xs font-semibold text-muted-foreground">+{Math.round(item.contribution * 100)} pts</span>
        )}
      </div>
      {item.edge && (
        <span className="inline-flex w-fit items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
          {item.edge.from_skill} → {item.skill}
          <span className="text-muted-foreground">· {item.edge.type} {item.edge.weight.toFixed(2)}</span>
        </span>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{item.reason}</p>
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

/**
 * The reusable FIT card — used unmodified by Recruitment, Onboarding, the
 * Recommendation Hub and the Skill Graph Explorer.
 */
export function FitCard({ fit }: { fit: FitRecord }) {
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
        <SectionBar label="Direct" value={sections.direct.value} detail={`${sections.direct.items.length} owned skill(s)`} />
        <SectionBar label="Adjacent" value={sections.adjacent.value} detail={`${sections.adjacent.items.length} adjacent path(s)`} />
        <SectionBar label="Evidence" value={sections.evidence.value} detail={`${sections.evidence.artifact_count}/${sections.evidence.threshold} verified artifacts`} />
        <SectionBar label="Seniority" value={sections.seniority.value} detail={`Level ${sections.seniority.candidate_level} vs ${sections.seniority.role_level}`} />
      </div>

      <div className="flex flex-col gap-4">
        <ItemGroup title="Direct skills" items={fit.classification.direct} />
        <ItemGroup title="Adjacent skills" items={fit.classification.adjacent} hint="backed by a graph edge" />
        <ItemGroup title="Transferable skills" items={fit.classification.transferable} hint="edge or same category" />
        <ItemGroup title="Gaps" items={fit.classification.gaps} />
      </div>
    </div>
  );
}
