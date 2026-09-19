import { ArrowLeftRight, BadgeCheck, Clock, FileText, Info, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { fitBand, type EvidenceItem, type FitItem, type FitLineage, type FitRecord } from "@/lib/skill-graph";

const CLASS_META: Record<
  FitItem["classification"],
  { label: string; icon: typeof BadgeCheck; chip: string; iconClass: string; hint: string }
> = {
  verified_direct: {
    label: "Verified direct",
    icon: BadgeCheck,
    chip: "bg-primary text-white",
    iconClass: "text-white",
    hint: "Accepted evidence, at/above the target bar.",
  },
  provisional_direct: {
    label: "Provisional direct",
    icon: FileText,
    chip: "bg-accent text-foreground",
    iconClass: "text-accent",
    hint: "Claimed or extracted only — not yet accepted evidence.",
  },
  below_target: {
    label: "Below target",
    icon: ArrowLeftRight,
    chip: "bg-muted text-foreground ring-1 ring-border",
    iconClass: "text-primary/70",
    hint: "Direct evidence exists but below the required bar.",
  },
  adjacent_support: {
    label: "Adjacent support",
    icon: RefreshCw,
    chip: "bg-secondary text-white",
    iconClass: "text-white",
    hint: "Related but not equivalent — no evidence for the skill itself.",
  },
  transferable_foundation: {
    label: "Transferable foundation",
    icon: Clock,
    chip: "bg-muted text-foreground",
    iconClass: "text-secondary/80",
    hint: "Weakest signal — development candidate, no points.",
  },
  missing: {
    label: "Missing",
    icon: XCircle,
    chip: "bg-muted text-muted-foreground",
    iconClass: "text-muted-foreground",
    hint: "No evidence or relationship path.",
  },
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

const stateMeta = (state: string | null) =>
  state ? STATE_META[state] ?? { label: state.split("_").join(" "), chip: "bg-muted text-foreground" } : null;

const pct = (n: number) => `${Math.round(n * 100)}`;

function ScoreBlock({ fit }: { fit: FitRecord }) {
  const band = fitBand(fit.score);
  const block = { high: "bg-primary text-white", mid: "bg-secondary text-white", low: "bg-accent text-foreground" }[band];
  return (
    <div className={`rounded-lg p-5 ${block}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-bold uppercase tracking-wider ${band === "low" ? "text-foreground/60" : "text-white/75"}`}>
            Verified readiness · accepted evidence only
          </p>
          <p className="mt-1 text-4xl font-extrabold tracking-tight">
            {pct(fit.score)}<span className="text-lg font-bold opacity-70">/100</span>
          </p>
          <p className={`mt-1 text-[11px] ${band === "low" ? "text-foreground/60" : "text-white/75"}`}>
            answers: how much of today's requirement is backed by accepted independent evidence?
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${band === "low" ? "bg-foreground text-white" : "bg-white/20 text-white"}`}>
            {fit.scenario === "future" ? "future target today" : "current"}
          </span>
          <span className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${fit.mandatory_gate.met ? "bg-white/20 text-white" : "bg-destructive text-white"}`}>
            {fit.mandatory_gate.met ? "Mandatory gate met" : "Mandatory gate NOT met"}
          </span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={`rounded-lg p-3 ${band === "low" ? "bg-foreground/5" : "bg-white/10"}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${band === "low" ? "text-foreground/50" : "text-white/70"}`}>Provisional profile match</p>
          <p className={`mt-0.5 text-xl font-extrabold ${band === "low" ? "text-foreground" : "text-white"}`}>{pct(fit.profile_match)}/100</p>
          <p className={`text-[10px] ${band === "low" ? "text-foreground/60" : "text-white/70"}`}>all live claims, evidence-attenuated</p>
        </div>
        <div className={`rounded-lg p-3 ${band === "low" ? "bg-foreground/5" : "bg-white/10"}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${band === "low" ? "text-foreground/50" : "text-white/70"}`}>Evidence confidence</p>
          <p className={`mt-0.5 text-xl font-extrabold ${band === "low" ? "text-foreground" : "text-white"}`}>{pct(fit.evidence_confidence)}/100</p>
          <p className={`text-[10px] ${band === "low" ? "text-foreground/60" : "text-white/70"}`}>weighted mean review rigor</p>
        </div>
        <div className={`rounded-lg p-3 ${band === "low" ? "bg-foreground/5" : "bg-white/10"}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${band === "low" ? "text-foreground/50" : "text-white/70"}`}>Requirement coverage</p>
          <p className={`mt-0.5 text-xl font-extrabold ${band === "low" ? "text-foreground" : "text-white"}`}>
            {fit.scoring.requirements.filter((r) => r.effective_proficiency >= r.required_proficiency).length}
            <span className="text-sm font-bold opacity-70">/{fit.scoring.requirements.length}</span>
          </p>
          <p className={`text-[10px] ${band === "low" ? "text-foreground/60" : "text-white/70"}`}>requirements at/above the bar</p>
        </div>
      </div>
    </div>
  );
}

function SectionBar({ label, value, detail, weightLabel, tone }: { label: string; value: number | null; detail: string; weightLabel: string; tone: "primary" | "secondary" }) {
  const v = value ?? 0;
  return (
    <div className="rounded-lg bg-muted p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="whitespace-nowrap text-lg font-extrabold text-foreground">
          {value === null ? "—" : pct(value)}
          <span className="text-[10px] font-semibold text-muted-foreground">{value === null ? "no criteria" : " of section"}</span>
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
        <div className={`h-full ${tone === "primary" ? "bg-primary" : "bg-secondary"}`} style={{ width: `${v * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      <p className="mt-1 text-[11px] font-semibold text-primary">{weightLabel}</p>
    </div>
  );
}

function ItemRow({ item }: { item: FitItem }) {
  const meta = CLASS_META[item.classification];
  const Icon = meta.icon;
  const state = stateMeta(item.evidence_state);
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${meta.chip}`} title={meta.hint}>
          <Icon className={`h-3.5 w-3.5 ${meta.iconClass}`} strokeWidth={2.5} />
          {meta.label}
        </span>
        <span className="text-sm font-bold text-foreground">{item.skill}</span>
        {item.mandatory && (
          <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">Mandatory</span>
        )}
        <span className="text-xs text-muted-foreground">
          req {item.required_proficiency}
          {item.candidate_proficiency !== null && item.relationship === "direct" && ` · holds ${item.candidate_proficiency}`}
          {item.relationship === "adjacent" && item.candidate_proficiency !== null && ` · via ${item.edge?.from_skill} @ ${item.candidate_proficiency}`}
        </span>
        <span className="ml-auto text-xs font-semibold text-muted-foreground">
          {item.verified ? `verified credit ${item.verified_contribution?.toFixed(2)}` : `profile credit ${item.contribution?.toFixed(2) ?? "0"}`}
          {item.gap > 0 ? ` · gap ${item.gap}` : " · met"}
        </span>
      </div>
      {state && (
        <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${state.chip}`}>{state.label}</span>
          {item.freshness_days !== null && (
            <span className="text-muted-foreground">evidence {item.freshness_days}d old</span>
          )}
        </span>
      )}
      {item.edge && (
        <span className="inline-flex w-fit items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
          {item.edge.from_skill} → {item.skill}
          <span className="text-muted-foreground">· {item.edge.type} weight {item.edge.weight.toFixed(2)}</span>
        </span>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{item.reason}</p>
      <p className="text-[11px] font-semibold text-foreground">{item.next_action}</p>
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
                  {meta && <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${meta.chip}`}>{meta.label}</span>}
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
 * The reusable FIT card — used by Recruitment (candidate detail), the
 * Recommendation Hub and the Skill Graph Explorer. Pass `lineage` (from the
 * skill-match response) to render the evidence lineage panel.
 *
 * Phase 9: the headline is VERIFIED READINESS (accepted evidence only), shown
 * next to the provisional profile match and evidence confidence. Seniority is
 * informational context only — it never contributes to the score.
 */
export function FitCard({ fit, lineage }: { fit: FitRecord; lineage?: FitLineage }) {
  const s = fit.scoring;
  const directItems = s.requirements.filter((i) => i.relationship === "direct");
  const adjacentItems = s.requirements.filter((i) => i.relationship === "adjacent");
  const transferableItems = s.requirements.filter((i) => i.relationship === "transferable");
  const gapItems = s.requirements.filter((i) => i.relationship === "none");

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-white p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-extrabold tracking-tight text-foreground">{fit.target_title}</h3>
          <p className="text-xs text-muted-foreground">
            {fit.scenario === "future" ? "Resolved 12–24 month target · today's evidence" : "Current requirements · today's evidence"} · computed {new Date(fit.computed_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      <ScoreBlock fit={fit} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SectionBar
          label="Mandatory"
          value={s.mandatory.readiness}
          detail={`${s.mandatory.met}/${s.mandatory.count} met · gate ${s.mandatory.gated ? "blocked" : "open"}`}
          weightLabel={`weighted ${Math.round(s.group_weights.mandatory * 100)}% of readiness`}
          tone="primary"
        />
        <SectionBar
          label="Preferred"
          value={s.preferred?.readiness ?? null}
          detail={s.preferred ? `${s.preferred.count} preferred criteria` : "no preferred criteria"}
          weightLabel={`weighted ${Math.round(s.group_weights.preferred * 100)}% of readiness`}
          tone="secondary"
        />
        <SectionBar label="Verified" value={s.verified.readiness} detail="accepted evidence only" weightLabel="== verified readiness" tone="primary" />
        <SectionBar label="Profile" value={s.provisional.readiness} detail="all live claims, attenuated" weightLabel="== profile match" tone="secondary" />
      </div>

      {!fit.mandatory_gate.met && (
        <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>Mandatory gate not met:</b> {fit.mandatory_gate.unmet_skills.join(", ")}. An unmet mandatory requirement
            cannot raise verified readiness, even when other criteria are strong.
          </span>
        </p>
      )}

      <p className="rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mr-1 inline h-3 w-3" />
        Every point comes from a requirement being satisfied by accepted evidence (direct or accepted-adjacent). There is
        no evidence-count or seniority component: unrelated evidence can never manufacture match points. Evidence quality
        attenuates the provisional profile match; seniority is context only.
      </p>

      <div className="flex flex-col gap-4">
        <ItemGroup title="Direct skills" items={directItems} />
        <ItemGroup title="Adjacent skills" items={adjacentItems} hint="backed by a graph edge — not equivalence" />
        <ItemGroup title="Transferable foundation" items={transferableItems} hint="no points — development signal only" />
        <ItemGroup title="Missing" items={gapItems} />
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
              engine v{fit.versions.engine} · evidence {fit.versions.evidence.slice(0, 8)} · requisition {fit.versions.requisition.slice(0, 8)} · plan {fit.versions.plan ?? "none"} · computed {new Date(fit.computed_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {lineage && <EvidenceLineagePanel lineage={lineage} />}
    </div>
  );
}
