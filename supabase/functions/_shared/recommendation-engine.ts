// ---------------------------------------------------------------------------
// WorkSense Recommendation trigger engine — deterministic, zero LLM.
// Scans multiple HR data sources (workforce signals, skill graph fits,
// performance, onboarding blockers) and emits recommendation candidates with
// a concrete evidence ledger. The model only writes the human-readable
// executive summary later; it never decides facts or urgency.
// ---------------------------------------------------------------------------

import { computeFit, type GraphSkill } from "./skill-graph-engine.ts";

export type RecCategory = "INTERNAL_MOBILITY" | "RETENTION_INTERVENTION" | "ONBOARDING_REPLAN";

export interface EvidenceFact {
  source: string;
  fact: string;
}

export interface RecCandidate {
  twin_id: string;
  category: RecCategory;
  urgency: "low" | "medium" | "high" | "critical";
  evidence_ledger: EvidenceFact[];
  proposed_action: { title: string; description: string; steps: { order: number; action: string }[] };
  required_signoff_role: "manager" | "hr_executive";
}

export interface ScanInputs {
  twins: {
    id: string;
    name: string;
    role: string;
    status: string;
    signals: { type?: string; value?: unknown; trend?: string; factors?: unknown }[];
    performance_history: { cycle: string; rating: string; goals_met?: number }[];
    verified_skills?: { name: string; proficiency: number; evidence_source?: string; verification_rigor?: string }[];
    seniority_level?: number;
    job_title?: string;
  }[];
  requisitions: {
    id: string;
    title: string;
    required_skills: { skill: string; target_proficiency: number }[];
    future_skills: { skill: string; target_proficiency: number }[];
    seniority_level: number;
  }[];
  graph: GraphSkill[];
  journeys: { twin_id: string; status: string; tasks: { id: string; title: string; status: string; blocked?: { note: string } | null }[] }[];
}

const RATING_ORDER: Record<string, number> = {
  "Needs Improvement": 1,
  "On Track": 2,
  "Meets Expectations": 3,
  "Exceeds Expectations": 4,
  "Exceptional": 5,
};

function signalValue(signals: { type?: string; value?: unknown }[]): number {
  const s = signals.find((x) => x.type === "workforce_review_signal");
  return typeof s?.value === "number" ? s.value : 0;
}

function latestRating(history: { rating: string }[]): string {
  return history.length > 0 ? history[history.length - 1].rating : "";
}

export function scanForRecommendations(inputs: ScanInputs): RecCandidate[] {
  const candidates: RecCandidate[] = [];

  for (const twin of inputs.twins) {
    if (twin.role === "candidate" || twin.status !== "active") continue;
    const signal = signalValue(twin.signals);

    // 1) RETENTION_INTERVENTION — signal alone flags the case.
    if (signal > 65) {
      const rating = latestRating(twin.performance_history);
      const strong = (RATING_ORDER[rating] ?? 0) >= 4;
      candidates.push({
        twin_id: twin.id,
        category: "RETENTION_INTERVENTION",
        urgency: signal > 75 ? "critical" : "high",
        evidence_ledger: [
          { source: "WORKFORCE_REVIEW_SIGNAL", fact: `Signal ${signal}/100 — multiple workforce indicators warrant HR review.` },
          ...(twin.signals.filter((s) => s.type === "engagement_survey").map((s) => ({ source: "ENGAGEMENT_SURVEY", fact: `Survey ${String(s.value)} ${s.trend ? `(${s.trend})` : ""}.` }))),
          { source: "PERFORMANCE", fact: `Latest rating: ${rating || "n/a"}${strong ? " — strong, stable delivery." : ""}.` },
        ],
        proposed_action: {
          title: "Manager review for retention intervention",
          description: `Open a structured check-in with ${twin.name} focused on engagement drivers, scope and growth path.`,
          steps: [
            { order: 1, action: "Book a 1:1 focused on engagement, not performance." },
            { order: 2, action: "Review the workforce signal factors together." },
            { order: 3, action: "Propose a growth, mobility or upskilling option." },
          ],
        },
        required_signoff_role: "manager",
      });
    }

    // 2) INTERNAL_MOBILITY — signal > 65 AND strong/stable performance AND the
    //    Skill Graph shows >=70% adjacent/transferable fit to an OPEN req.
    if (signal > 65 && (RATING_ORDER[latestRating(twin.performance_history)] ?? 0) >= 4) {
      // Domain mapping: the scan may carry partial skill claims; the engine
      // requires full SkillClaim records, so fill defaults explicitly.
      const candidateSkills: import("./skill-graph-engine.ts").SkillClaim[] = (twin.verified_skills ?? []).map((s) => ({
        name: s.name,
        proficiency: s.proficiency,
        evidence_source: s.evidence_source ?? "skill_scan",
        verification_rigor: (s.verification_rigor as "low" | "medium" | "high") ?? "low",
      }));
      for (const req of inputs.requisitions) {
        const fit = computeFit({
          candidateSkills,
          candidateLevel: twin.seniority_level ?? 3,
          requiredSkills: req.required_skills,
          roleLevel: req.seniority_level,
          skillGraph: inputs.graph,
          target: { type: "requisition", id: req.id, title: req.title },
          scenario: "current",
        });
        const soft = fit.classification.adjacent.length + fit.classification.transferable.length;
        const direct = fit.classification.direct.length;
        // ">=70% adjacent/transferable fit": at least 70% of the COVERED
        // requirement paths were reached via adjacent/transferable edges, and
        // at least two such paths exist (a single same-category transfer is
        // too weak to justify a mobility recommendation).
        const covered = direct + soft;
        const softShare = covered > 0 ? soft / covered : 0;
        if (softShare >= 0.7 && covered >= 2) {
          candidates.push({
            twin_id: twin.id,
            category: "INTERNAL_MOBILITY",
            urgency: signal > 75 ? "high" : "medium",
            evidence_ledger: [
              { source: "WORKFORCE_REVIEW_SIGNAL", fact: `Signal ${signal}/100.` },
              { source: "PERFORMANCE", fact: `Latest rating: ${latestRating(twin.performance_history)} — strong, stable.` },
              { source: "SKILL_GRAPH", fact: `${Math.round(fit.score * 100)}% match vs ${req.title}; ${direct} direct, ${soft} adjacent/transferable path(s) across required_skills.` },
            ],
            proposed_action: {
              title: "Manager review for internal mobility",
              description: `Evaluate ${twin.name} for movement toward ${req.title} using the adjacent/transferable fit.`,
              steps: [
                { order: 1, action: "Review the skill-graph fit breakdown." },
                { order: 2, action: "Discuss scope/growth with the employee." },
                { order: 3, action: "Decide on a mobility or upskilling path." },
              ],
            },
            required_signoff_role: "manager",
          });
          break;
        }
      }
    }
  }

  // 3) ONBOARDING_REPLAN — a journey with a blocked task needs a replan.
  for (const j of inputs.journeys) {
    const blocked = (j.tasks ?? []).find((t) => t.status === "blocked");
    if (blocked) {
      candidates.push({
        twin_id: j.twin_id,
        category: "ONBOARDING_REPLAN",
        urgency: "high",
        evidence_ledger: [
          { source: "ONBOARDING_BLOCKER", fact: `Task "${blocked.title}" blocked: ${blocked.blocked?.note ?? "blocker reported"}.` },
        ],
        proposed_action: {
          title: "Approve onboarding replan",
          description: "Re-open the journey for replanning and re-approval after the blocker.",
          steps: [
            { order: 1, action: "Review the blocked task and its downstream impact." },
            { order: 2, action: "Re-queue the plan (dates recomputed deterministically)." },
            { order: 3, action: "Re-approve with Manager + HR." },
          ],
        },
        required_signoff_role: "manager",
      });
    }
  }

  return candidates;
}
