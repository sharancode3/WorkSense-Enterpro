// ---------------------------------------------------------------------------
// WorkSense Recommendation trigger engine — deterministic, zero LLM.
// Scans multiple HR data sources (workforce signals, skill graph fits,
// performance, onboarding blockers) and emits recommendation candidates with
// a concrete evidence ledger. The model only writes the human-readable
// executive summary later; it never decides facts or urgency.
// ---------------------------------------------------------------------------

import { computeFit, type GraphSkill } from "./skill-graph-engine.ts";

export type RecCategory =
  | "INTERNAL_MOBILITY"
  | "RETENTION_INTERVENTION"
  | "ONBOARDING_REPLAN"
  | "DEVELOPMENT_SUPPORT"
  | "RECRUITMENT_ASSESSMENT_REVIEW";

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
  required_signoff_role: "manager" | "hr_executive" | "recruiter";
  // Phase 11: the req the recommendation is about + ranked alternatives.
  resource_ref?: string;
  alternatives?: { req_id: string; title: string; fit_score: number; coverage: number }[];
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
    // Phase 9: review-index metadata computed from the deterministic engine.
    review_meta?: { data_completeness?: number; priority?: string; seeking_growth?: boolean };
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
  // Phase 11: recruitment recommendations REQUIRE actual application evidence.
  applications?: { twin_id: string; requisition_id: string; stage: string; application_code: string; unverified_claims?: number }[];
}

const RATING_ORDER: Record<string, number> = {
  "Needs Improvement": 1,
  "On Track": 2,
  "Meets Expectations": 3,
  "Exceeds Expectations": 4,
  "Exceptional": 5,
};

// Review INDEX (preferred) with legacy-signal fallback. The value is an
// interpretable review-priority composite, never a probability of leaving.
function reviewIndexValue(signals: { type?: string; value?: unknown }[]): number {
  const idx = signals.find((x) => x.type === "workforce_review_index");
  if (typeof idx?.value === "number") return idx.value;
  const legacy = signals.find((x) => x.type === "workforce_review_signal");
  return typeof legacy?.value === "number" ? legacy.value : 0;
}

function latestRating(history: { rating: string }[]): string {
  return history.length > 0 ? history[history.length - 1].rating : "";
}

export function scanForRecommendations(inputs: ScanInputs): RecCandidate[] {
  const candidates: RecCandidate[] = [];

  for (const twin of inputs.twins) {
    if (twin.role === "candidate" || twin.status !== "active") continue;
    const index = reviewIndexValue(twin.signals);
    const meta = twin.review_meta ?? {};
    const completeness = typeof meta.data_completeness === "number" ? meta.data_completeness : null;
    const growth = meta.seeking_growth === true || twin.signals.some((s) => s.type === "seeks_growth" && s.value === true);
    const incomplete = completeness !== null && completeness < 0.75;

    // 1) RETENTION_INTERVENTION — elevated review index flags a case. Seeking
    //    growth alone NEVER triggers it; missing data never escalates it.
    if (index > 65) {
      const rating = latestRating(twin.performance_history);
      const strong = (RATING_ORDER[rating] ?? 0) >= 4;
      const urgency = index > 75 ? "critical" : "high";
      candidates.push({
        twin_id: twin.id,
        category: "RETENTION_INTERVENTION",
        // Incomplete data (or growth interest with strong delivery) softens the
        // case: it becomes a review conversation, not a priority action.
        urgency: incomplete ? (urgency === "critical" ? "high" : "medium") : growth && strong ? "medium" : urgency,
        evidence_ledger: [
          { source: "WORKFORCE_REVIEW_SIGNAL", fact: `Workforce Review Index ${index}/100 — interpretable review priority, NOT a probability of leaving.` },
          ...(twin.signals.filter((s) => s.type === "engagement_survey").map((s) => ({ source: "ENGAGEMENT_SURVEY", fact: `Survey ${String(s.value)} ${s.trend ? `(${s.trend})` : ""}.` }))),
          { source: "PERFORMANCE", fact: `Latest rating: ${rating || "n/a"}${strong ? " — strong, stable delivery." : ""}.` },
          ...(incomplete ? [{ source: "DATA_COMPLETENESS", fact: `Observation history is ${Math.round(completeness! * 100)}% complete — missing data is not poor performance; complete the gaps during review.` }] : []),
          ...(growth ? [{ source: "SEEKS_GROWTH", fact: "Employee reports development interest — treat as a growth conversation, not a risk signal." }] : []),
        ],
        proposed_action: {
          title: "Manager review conversation (retention support)",
          description: `Open a structured check-in with ${twin.name} focused on engagement drivers, scope and growth path.`,
          steps: [
            { order: 1, action: "Book a 1:1 focused on engagement, not performance." },
            { order: 2, action: "Review the Workforce Review Index factors together." },
            { order: 3, action: "Propose a growth, mobility or upskilling option." },
          ],
        },
        required_signoff_role: "manager",
      });
    }

    // 2) DEVELOPMENT_SUPPORT — healthy development interest with a LOW review
    //    index. This is a growth conversation, never a risk or attrition flag.
    if (growth && index < 65) {
      candidates.push({
        twin_id: twin.id,
        category: "DEVELOPMENT_SUPPORT",
        urgency: "low",
        evidence_ledger: [
          { source: "SEEKS_GROWTH", fact: "Employee reports development interest (self-reported, time-boxed)." },
          { source: "WORKFORCE_REVIEW_SIGNAL", fact: `Workforce Review Index ${index}/100 — low priority; this is NOT a risk case.` },
          ...(twin.signals.filter((s) => s.type === "engagement_survey").map((s) => ({ source: "ENGAGEMENT_SURVEY", fact: `Survey ${String(s.value)} ${s.trend ? `(${s.trend})` : ""}.` }))),
        ],
        proposed_action: {
          title: "Development / growth conversation",
          description: `Plan scope, mentoring and upskilling with ${twin.name}. Development interest is a growth signal — not attrition intent.`,
          steps: [
            { order: 1, action: "Discuss career goals and the growth ladder for the role." },
            { order: 2, action: "Match a mentoring or upskilling option (e.g. L&D budget)." },
            { order: 3, action: "Schedule a follow-up review conversation." },
          ],
        },
        required_signoff_role: "manager",
      });
    }

    // 3) INTERNAL_MOBILITY — elevated index AND strong/stable performance AND
    //    meaningful target coverage: >=60% of the req's required skills are
    //    covered by direct/adjacent/transferable paths, >=70% of covered
    //    skills are reached via adjacent/transferable edges, and at least two
    //    paths exist. ALL requisitions are evaluated and the best fit is
    //    selected (with ranked alternatives), not the first match.
    if (index > 65 && (RATING_ORDER[latestRating(twin.performance_history)] ?? 0) >= 4) {
      const candidateSkills: import("./skill-graph-engine.ts").SkillClaim[] = (twin.verified_skills ?? []).map((s) => ({
        name: s.name,
        proficiency: s.proficiency,
        evidence_source: s.evidence_source ?? "skill_scan",
        verification_rigor: (s.verification_rigor as "low" | "medium" | "high") ?? "low",
      }));
      const evaluated: { req: (typeof inputs.requisitions)[number]; fit: import("./skill-graph-engine.ts").FitRecord; soft: number; direct: number; covered: number; covered_ratio: number; soft_share: number; coverage_score: number }[] = [];
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
        const total = (req.required_skills ?? []).length;
        const covered = direct + soft;
        const covered_ratio = total > 0 ? covered / total : 0;
        const soft_share = covered > 0 ? soft / covered : 0;
        // Meaningful coverage: a majority of the TARGET skills must be
        // covered — not merely a high soft-share among a few covered skills.
        if (covered_ratio >= 0.6 && soft_share >= 0.7 && covered >= 2) {
          evaluated.push({ req, fit, soft, direct, covered, covered_ratio, soft_share, coverage_score: covered_ratio * fit.score });
        }
      }
      if (evaluated.length > 0) {
        evaluated.sort((a, b) => b.coverage_score - a.coverage_score);
        const best = evaluated[0];
        const alternatives = evaluated.slice(1, 4).map((e) => ({
          req_id: e.req.id,
          title: e.req.title,
          fit_score: +e.fit.score.toFixed(3),
          coverage: +e.covered_ratio.toFixed(2),
        }));
        candidates.push({
          twin_id: twin.id,
          category: "INTERNAL_MOBILITY",
          urgency: index > 75 ? "high" : "medium",
          resource_ref: best.req.id,
          alternatives,
          evidence_ledger: [
            { source: "WORKFORCE_REVIEW_SIGNAL", fact: `Workforce Review Index ${index}/100 — interpretable review priority, NOT a probability of leaving.` },
            { source: "PERFORMANCE", fact: `Latest rating: ${latestRating(twin.performance_history)} — strong, stable.` },
            { source: "SKILL_GRAPH", fact: `${Math.round(best.fit.score * 100)}% match vs ${best.req.title}; ${best.direct} direct, ${best.soft} adjacent/transferable path(s); ${Math.round(best.covered_ratio * 100)}% of the target skills covered (meaningful coverage).` },
            ...(alternatives.length > 0 ? [{ source: "ALTERNATIVES", fact: `Alternatives considered: ${alternatives.map((a) => `${a.title} (${Math.round(a.fit_score * 100)}% fit)`).join(", ")}.` }] : []),
          ],
          proposed_action: {
            title: "Manager review for internal mobility",
            description: `Evaluate ${twin.name} for movement toward ${best.req.title} (best coverage among ${evaluated.length} candidate role(s)).`,
            steps: [
              { order: 1, action: "Review the skill-graph fit breakdown and the alternatives considered." },
              { order: 2, action: "Confirm capacity with the manager (staffing cover)." },
              { order: 3, action: "Discuss scope/growth with the employee." },
              { order: 4, action: "Decide on a mobility or upskilling path." },
            ],
          },
          required_signoff_role: "manager",
        });
      }
    }
  }

  // 4) RECRUITMENT_ASSESSMENT_REVIEW — requires an ACTUAL application record
  //    (evidence), not just a fit score, and visible assessment gaps
  //    (unverified skill claims). The action task is owned by the recruiter.
  const apps = inputs.applications ?? [];
  const appliedCandidates = new Map<string, (typeof apps)[number]>();
  for (const a of apps) {
    if (!appliedCandidates.has(a.twin_id)) appliedCandidates.set(a.twin_id, a);
  }
  for (const twin of inputs.twins) {
    if (twin.role !== "candidate" || !["candidate", "active"].includes(twin.status)) continue;
    const app = appliedCandidates.get(twin.id);
    if (!app) continue; // no application record -> no recruitment recommendation
    const unverified = app.unverified_claims ?? 0;
    if (unverified > 0) {
      candidates.push({
        twin_id: twin.id,
        category: "RECRUITMENT_ASSESSMENT_REVIEW",
        urgency: "medium",
        resource_ref: app.requisition_id,
        evidence_ledger: [
          { source: "APPLICATION", fact: `Application ${app.application_code} for requisition at stage "${app.stage}" — actual application evidence on record.` },
          { source: "ASSESSMENT_GAPS", fact: `${unverified} skill claim(s) remain unverified (self-reported only) — review assessment gaps before advancing the stage.` },
        ],
        proposed_action: {
          title: "Review assessment gaps before advancing",
          description: `Have the recruiter review ${twin.name}'s assessment gaps and decide whether to collect more evidence or advance the stage.`,
          steps: [
            { order: 1, action: "Review the unverified claims and assessment evidence." },
            { order: 2, action: "Collect a work sample or interview evidence for the gaps." },
            { order: 3, action: "Update the application stage with a recorded reason." },
          ],
        },
        required_signoff_role: "recruiter",
      });
    }
  }

  // 5) ONBOARDING_REPLAN — a journey with a blocked task needs a replan.
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
