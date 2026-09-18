// ---------------------------------------------------------------------------
// WorkSense constrained staffing planner — pure, deterministic core.
// Replaces the fixed comparison with an explicit scenario model:
//  - skill-by-skill capability (never a scalar union)
//  - separate CURRENT verified coverage vs CONDITIONAL future coverage
//  - mandatory-skill gates before any option is "ready"
//  - sequential/parallel stages with the ACTUAL latest finish (never clamped)
//  - status vocabulary: feasible | conditional | infeasible | insufficient_data
//  - explicit candidate filtering (reject/expire/stale rules)
// Zero LLM — the model may only narrate the numbers this engine produces.
// ---------------------------------------------------------------------------

export type PlannerStatus = "feasible" | "conditional" | "infeasible" | "insufficient_data";

export interface RequiredSkill {
  skill: string;
  min_proficiency: number;
  mandatory: boolean;
}

export interface ScenarioInput {
  name: string;
  demand_title: string;
  department?: string;
  required_skills: RequiredSkill[];
  capacity_people: number;
  deadline_days: number;
  budget_usd: number;
  geography?: string;
  horizon_months: number;
  assumptions_version: string;
}

export interface PersonSkill {
  name: string;
  proficiency: number;
  verification_rigor: "low" | "medium" | "high";
}

export interface Person {
  id: string;
  name: string;
  department?: string | null;
  manager_id?: string | null;
  current_assignment?: string | null; // non-null critical project => not available
  skills: PersonSkill[];
}

export interface Candidate {
  id: string;
  name: string;
  status: string; // active | invited | rejected | expired | ...
  applied_at?: string;
  match_score?: number | null;
  skills: PersonSkill[];
}

export interface Assumptions {
  version: string;
  hire_lead_days: number;
  hire_cost_usd: number;
  move_transition_days: number; // handover + transfer
  move_cost_usd: number;
  manager_approval_days: number;
  training_days_per_skill: number; // sequential per skill
  training_cost_usd_per_skill: number;
  verification_days: number;
  candidate_stale_days: number; // applied_at older than this => stale, excluded
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  version: "v1",
  hire_lead_days: 56,
  hire_cost_usd: 45000,
  move_transition_days: 14,
  move_cost_usd: 6000,
  manager_approval_days: 5,
  training_days_per_skill: 21,
  training_cost_usd_per_skill: 1200,
  verification_days: 7,
  candidate_stale_days: 180,
};

export type CoverageKind = "verified" | "conditional" | "gap" | "absent";

export interface SkillCoverageRow {
  skill: string;
  min_proficiency: number;
  mandatory: boolean;
  coverage: CoverageKind;
  current_proficiency: number | null;
  projected_proficiency: number | null;
  source: string;
  mandatory_satisfied: boolean;
}

export interface Stage {
  name: string;
  kind: "hire" | "approval" | "handover" | "training" | "verification" | "transition";
  duration_days: number;
  parallel: boolean;
}

export interface OptionResult {
  id: string;
  label: string;
  status: PlannerStatus;
  status_reason: string;
  skill_coverage: SkillCoverageRow[];
  verified_coverage_pct: number; // of REQUIRED skills covered by CURRENT verified skills
  conditional_coverage_pct: number; // coverage only after conditions (training/verification/hire)
  mandatory_satisfied: boolean;
  mandatory_missing: string[];
  timeline: Stage[];
  ready_at_days: number; // actual latest finish, never clamped to deadline
  meets_deadline: boolean;
  cost_usd: number;
  budget_satisfied: boolean;
  dependency_risk: "low" | "medium" | "high";
  constraints_satisfied: string[];
  constraints_violated: string[];
  rationale: string; // why this satisfies + why alternatives fail
  subject?: string; // chosen person / candidate name
}

export interface PlanResult {
  scenario: ScenarioInput;
  assumptions: Assumptions;
  options: OptionResult[];
  decision_table: {
    option_id: string;
    cost_usd: number;
    ready_at_days: number;
    verified_coverage_pct: number;
    conditional_coverage_pct: number;
    status: PlannerStatus;
  }[];
  note: string;
}

const norm = (s: string) => String(s ?? "").trim().toLowerCase();

function skillLevel(person: { skills: PersonSkill[] }, skill: string): number | null {
  const hit = (person.skills ?? []).find((s) => norm(s.name) === norm(skill));
  return hit && hit.proficiency > 0 ? hit.proficiency : null;
}

/** Candidates: only active/invited, not rejected/expired/stale, with enough
 *  known skill data to assess (item 16). */
function usableCandidates(candidates: Candidate[], assumptions: Assumptions): Candidate[] {
  const now = Date.now();
  const STALE = assumptions.candidate_stale_days * 86400000;
  return (candidates ?? []).filter((c) => {
    if (!["active", "invited"].includes(c.status)) return false;
    if (c.applied_at && now - new Date(c.applied_at).getTime() > STALE) return false;
    if ((c.skills ?? []).length === 0 && c.match_score == null) return false;
    return true;
  });
}

function latestFinish(stages: Stage[]): number {
  // Sequential stages sum; parallel stages contribute their max within a
  // group. Model: stages in order; a stage with parallel:true runs alongside
  // the previous sequential stage and adds its max.
  let seq = 0;
  let runningMax = 0;
  for (const s of stages) {
    if (s.parallel) {
      runningMax = Math.max(runningMax, s.duration_days);
    } else {
      seq += s.duration_days + runningMax;
      runningMax = 0;
    }
  }
  return seq + runningMax;
}

function coverageRow(
  req: RequiredSkill,
  coverage: CoverageKind,
  current: number | null,
  projected: number | null,
  source: string
): SkillCoverageRow {
  const effective = coverage === "verified" ? (projected ?? current ?? 0) : coverage === "conditional" ? (projected ?? 0) : 0;
  return {
    skill: req.skill,
    min_proficiency: req.min_proficiency,
    mandatory: req.mandatory,
    coverage,
    current_proficiency: current,
    projected_proficiency: projected,
    source,
    mandatory_satisfied: !req.mandatory || effective >= req.min_proficiency,
  };
}

function planSummary(input: ScenarioInput, a: Assumptions, population: Person[], candidates: Candidate[]): PlanResult {
  const usable = usableCandidates(candidates, a);
  const skills = input.required_skills;

  // Shared coverage helper across options.
  const coverageFor = (person: Person | null, trained: Set<string>): SkillCoverageRow[] =>
    skills.map((req) => {
      const cur = person ? skillLevel(person, req.skill) : null;
      if (cur !== null && cur >= req.min_proficiency) {
        return coverageRow(req, "verified", cur, cur, `verified ${cur}/${req.min_proficiency}`);
      }
      if (person && trained.has(norm(req.skill))) {
        return coverageRow(req, "conditional", cur, req.min_proficiency, `training projection to ${req.min_proficiency} — pending verification`);
      }
      if (person) {
        return coverageRow(req, "gap", cur, null, `below required bar (${cur ?? "none"}/${req.min_proficiency})`);
      }
      return coverageRow(req, "absent", null, null, "no source identified");
    });

  const summarize = (rows: SkillCoverageRow[]) => {
    const verified = rows.filter((r) => r.coverage === "verified").length;
    const conditional = rows.filter((r) => r.coverage === "conditional").length;
    const mandatoryMissing = rows.filter((r) => r.mandatory && !r.mandatory_satisfied).map((r) => r.skill);
    return {
      verified_coverage_pct: Math.round((verified / Math.max(1, rows.length)) * 100),
      conditional_coverage_pct: Math.round(((verified + conditional) / Math.max(1, rows.length)) * 100),
      mandatory_satisfied: mandatoryMissing.length === 0,
      mandatory_missing: mandatoryMissing,
    };
  };

  const options: OptionResult[] = [];

  // --- HIRE ------------------------------------------------------------------
  const hireSubject = usable
    .map((c) => ({
      c,
      matched: skills.filter((r) => {
        const lvl = skillLevel(c, r.skill);
        return lvl !== null && lvl >= r.min_proficiency;
      }).length,
      mandatoryOk: skills.filter((r) => r.mandatory).every((r) => {
        const lvl = skillLevel(c, r.skill);
        return lvl !== null && lvl >= r.min_proficiency;
      }),
    }))
    .filter((x) => x.matched > 0 && x.mandatoryOk)
    .sort((x, y) => y.matched - x.matched)[0];

  if (hireSubject) {
    const rows = coverageFor(hireSubject.c, new Set());
    const s = summarize(rows);
    const ready = latestFinish([{ name: `Hire "${hireSubject.c.name}"`, kind: "hire", duration_days: a.hire_lead_days, parallel: false }]);
    const meets = ready <= input.deadline_days;
    const status: PlannerStatus = meets ? "conditional" : "infeasible";
    options.push({
      id: "hire",
      label: "Hire externally",
      status,
      status_reason: meets
        ? "Feasible only if the external hire completes on time — external lead time is a stated condition, not a certainty. 54% (or any) aggregate match is never role-ready on its own; readiness is gated on each mandatory skill."
        : `The hire track needs ${ready} days (lead time ${a.hire_lead_days}d), beyond the ${input.deadline_days}-day deadline. It is NOT clamped to the deadline — it is infeasible for this window.`,
      skill_coverage: rows,
      verified_coverage_pct: s.verified_coverage_pct,
      conditional_coverage_pct: s.conditional_coverage_pct,
      mandatory_satisfied: s.mandatory_satisfied,
      mandatory_missing: s.mandatory_missing,
      timeline: [{ name: "Hire + onboarding", kind: "hire", duration_days: a.hire_lead_days, parallel: false }],
      ready_at_days: ready,
      meets_deadline: meets,
      cost_usd: a.hire_cost_usd,
      budget_satisfied: a.hire_cost_usd <= input.budget_usd,
      dependency_risk: "high",
      constraints_satisfied: [
        "Mandatory skills covered by the candidate's claims at the required bar",
        `Hire lead time ${a.hire_lead_days}d modeled as a single external stage`,
      ],
      constraints_violated: meets ? [] : [`Hire ready at day ${ready} exceeds the ${input.deadline_days}-day deadline`],
      rationale: `Hire can cover all mandatory skills via ${hireSubject.c.name}, but depends on a ${a.hire_lead_days}-day external lead time. It fails whenever the deadline is shorter than that, which is exactly why ${meets ? "it remains conditional, not ready" : "it is infeasible here"}.`,
      subject: hireSubject.c.name,
    });
  } else {
    options.push({
      id: "hire",
      label: "Hire externally",
      status: usable.length === 0 ? "insufficient_data" : "infeasible",
      status_reason: usable.length === 0
        ? "No usable candidate records exist in the pipeline (rejected/expired/stale records were excluded by rule) — insufficient data to assess a hire."
        : "No candidate in the usable pipeline satisfies every mandatory skill at the required bar — a hire cannot be called role-ready.",
      skill_coverage: skills.map((r) => coverageRow(r, "absent", null, null, "no candidate satisfies this requirement")),
      verified_coverage_pct: 0,
      conditional_coverage_pct: 0,
      mandatory_satisfied: false,
      mandatory_missing: skills.filter((r) => r.mandatory).map((r) => r.skill),
      timeline: [{ name: "Hire + onboarding", kind: "hire", duration_days: a.hire_lead_days, parallel: false }],
      ready_at_days: a.hire_lead_days,
      meets_deadline: a.hire_lead_days <= input.deadline_days,
      cost_usd: a.hire_cost_usd,
      budget_satisfied: a.hire_cost_usd <= input.budget_usd,
      dependency_risk: "high",
      constraints_satisfied: [],
      constraints_violated: ["No suitable candidate covers every mandatory skill"],
      rationale: "External hire cannot be assessed as role-ready without a candidate who meets every mandatory skill. A partial or low match does not make the role ready.",
    });
  }

  // --- INTERNAL MOVE -----------------------------------------------------------
  const moveCandidates = population
    .map((p) => ({ p, matched: skills.filter((r) => (skillLevel(p, r.skill) ?? 0) >= r.min_proficiency).length }))
    .sort((x, y) => y.matched - x.matched);
  const bestMove = moveCandidates.find((x) =>
    skills.filter((r) => r.mandatory).every((r) => (skillLevel(x.p, r.skill) ?? 0) >= r.min_proficiency)
  ) ?? moveCandidates[0];

  if (bestMove && bestMove.matched > 0) {
    const rows = coverageFor(bestMove.p, new Set());
    const s = summarize(rows);
    const unavailable = Boolean(bestMove.p.current_assignment);
    const stages: Stage[] = [
      { name: "Source-manager approval", kind: "approval", duration_days: a.manager_approval_days, parallel: false },
      { name: "Handover + transition", kind: "handover", duration_days: a.move_transition_days, parallel: false },
    ];
    const ready = latestFinish(stages);
    const meets = ready <= input.deadline_days && !unavailable;
    const status: PlannerStatus = !s.mandatory_satisfied ? "infeasible" : unavailable ? "infeasible" : meets ? "feasible" : "infeasible";
    options.push({
      id: "move",
      label: "Internal move",
      status,
      status_reason: s.mandatory_satisfied
        ? unavailable
          ? `${bestMove.p.name} is currently assigned to "${bestMove.p.current_assignment}" — an internal move requires availability; until a backfill is approved the move is infeasible.`
          : meets
            ? `Move is ready in ${ready} days (approval ${a.manager_approval_days}d + handover ${a.move_transition_days}d), inside the ${input.deadline_days}-day window. Feasible.`
            : `Move needs ${ready} days, beyond the ${input.deadline_days}-day window — not clamped, therefore infeasible for this deadline.`
        : `Move fails the mandatory-skill gate: ${s.mandatory_missing.join(", ")} are not verified at the required bar.`,
      skill_coverage: rows,
      verified_coverage_pct: s.verified_coverage_pct,
      conditional_coverage_pct: s.conditional_coverage_pct,
      mandatory_satisfied: s.mandatory_satisfied,
      mandatory_missing: s.mandatory_missing,
      timeline: stages,
      ready_at_days: ready,
      meets_deadline: meets,
      cost_usd: a.move_cost_usd,
      budget_satisfied: a.move_cost_usd <= input.budget_usd,
      dependency_risk: unavailable ? "high" : "medium",
      constraints_satisfied: [
        s.mandatory_satisfied ? "All mandatory skills verified on the candidate" : "—",
        "Availability and source-manager approval are explicit stages",
        "Handover/backfill impact modeled as a 14-day transition",
      ].filter((c) => c !== "—"),
      constraints_violated: [
        ...(unavailable ? [`Currently assigned to "${bestMove.p.current_assignment}" — needs a backfill decision`] : []),
        ...(meets ? [] : [`Move ready at day ${ready} exceeds the ${input.deadline_days}-day deadline`]),
      ],
      rationale: `Move uses ${bestMove.p.name}'s verified skills (${s.verified_coverage_pct}% verified coverage). It satisfies the mandatory-skill gate${unavailable ? " but is blocked by a current assignment, so alternatives must be considered" : meets ? " and fits the window" : " but not the window, so it fails where hire/upskill timing or availability differ"}.`,
      subject: bestMove.p.name,
    });
  } else {
    options.push({
      id: "move",
      label: "Internal move",
      status: population.length === 0 ? "insufficient_data" : "infeasible",
      status_reason: population.length === 0
        ? "No authorized internal population is available in this scope — insufficient data to assess a move."
        : "No internal person in scope covers any required skill at the minimum bar — an internal move cannot be role-ready.",
      skill_coverage: skills.map((r) => coverageRow(r, "absent", null, null, "no internal candidate covers this skill")),
      verified_coverage_pct: 0,
      conditional_coverage_pct: 0,
      mandatory_satisfied: false,
      mandatory_missing: skills.filter((r) => r.mandatory).map((r) => r.skill),
      timeline: [
        { name: "Source-manager approval", kind: "approval", duration_days: a.manager_approval_days, parallel: false },
        { name: "Handover + transition", kind: "handover", duration_days: a.move_transition_days, parallel: false },
      ],
      ready_at_days: a.manager_approval_days + a.move_transition_days,
      meets_deadline: a.manager_approval_days + a.move_transition_days <= input.deadline_days,
      cost_usd: a.move_cost_usd,
      budget_satisfied: a.move_cost_usd <= input.budget_usd,
      dependency_risk: "medium",
      constraints_satisfied: [],
      constraints_violated: ["No internal person covers the required skills at the bar"],
      rationale: "Without an internal person who already covers the required skills, an internal move cannot satisfy the mandatory-skill gate.",
    });
  }

  // --- UPSKILL ----------------------------------------------------------------
  const bestUpskill = [...moveCandidates].sort((x, y) => y.matched - x.matched)[0];
  if (bestUpskill && bestUpskill.matched > 0) {
    const toTrain = new Set(skills.filter((r) => (skillLevel(bestUpskill.p, r.skill) ?? 0) < r.min_proficiency).map((r) => norm(r.skill)));
    const rows = coverageFor(bestUpskill.p, toTrain);
    const s = summarize(rows);
    const trainCount = skills.filter((r) => toTrain.has(norm(r.skill))).length;
    const stages: Stage[] = [
      ...skills.filter((r) => toTrain.has(norm(r.skill))).map((r) => ({ name: `Train ${r.skill}`, kind: "training" as const, duration_days: a.training_days_per_skill, parallel: false })),
      { name: "Evidence verification", kind: "verification", duration_days: a.verification_days, parallel: false },
    ];
    const ready = latestFinish(stages);
    const meets = ready <= input.deadline_days;
    // Training is a CONDITIONAL projection until verification succeeds (item 13).
    const status: PlannerStatus = trainCount === 0 ? "feasible" : meets ? "conditional" : "infeasible";
    const cost = a.training_cost_usd_per_skill * trainCount;
    options.push({
      id: "upskill",
      label: "Upskill internally",
      status,
      status_reason: trainCount === 0
        ? `${bestUpskill.p.name} already covers every required skill — no training needed; this collapses to a move (see Move).`
        : meets
          ? `Upskill projects ${bestUpskill.p.name} to the required bars for ${trainCount} skill(s), then requires evidence verification. Coverage is CONDITIONAL until verification succeeds — training does not create verified capability by itself.`
          : `Training (${trainCount} skill(s) × ${a.training_days_per_skill}d) + verification (${a.verification_days}d) needs ${ready} days, beyond the ${input.deadline_days}-day window — not clamped, therefore infeasible for this deadline.`,
      skill_coverage: rows,
      verified_coverage_pct: s.verified_coverage_pct,
      conditional_coverage_pct: s.conditional_coverage_pct,
      mandatory_satisfied: s.mandatory_satisfied,
      mandatory_missing: s.mandatory_missing,
      timeline: stages,
      ready_at_days: ready,
      meets_deadline: meets,
      cost_usd: cost,
      budget_satisfied: cost <= input.budget_usd,
      dependency_risk: "medium",
      constraints_satisfied: [
        "Mandatory skills reach the bar (verified or conditional-on-verification)",
        "Training staged sequentially with explicit verification",
      ],
      constraints_violated: meets ? [] : [`Upskill ready at day ${ready} exceeds the ${input.deadline_days}-day deadline`],
      rationale: `Upskill builds on ${bestUpskill.p.name}'s ${s.verified_coverage_pct}% verified coverage and projects the missing skills as CONDITIONAL. It cannot be called ready before verification — which is why it fails when the deadline is shorter than training+verification.`,
      subject: bestUpskill.p.name,
    });
  } else {
    options.push({
      id: "upskill",
      label: "Upskill internally",
      status: population.length === 0 ? "insufficient_data" : "infeasible",
      status_reason: "No internal person provides a verified starting point — upskilling from nothing cannot be projected reliably.",
      skill_coverage: skills.map((r) => coverageRow(r, "absent", null, null, "no internal starting point")),
      verified_coverage_pct: 0,
      conditional_coverage_pct: 0,
      mandatory_satisfied: false,
      mandatory_missing: skills.filter((r) => r.mandatory).map((r) => r.skill),
      timeline: [],
      ready_at_days: 0,
      meets_deadline: false,
      cost_usd: 0,
      budget_satisfied: true,
      dependency_risk: "medium",
      constraints_satisfied: [],
      constraints_violated: ["No verified internal starting point"],
      rationale: "Upskill requires a verified base to project from; with none available it is infeasible.",
    });
  }

  // --- HYBRID (hire + upskill) ------------------------------------------------
  const hireOpt = options.find((o) => o.id === "hire");
  const upskillOpt = options.find((o) => o.id === "upskill");
  if (hireOpt && upskillOpt && hireOpt.subject && upskillOpt.subject) {
    // BOTH tracks must finish; the hybrid is ready when the LATEST track is
    // done (item 18) — never clamped, never min().
    const hireReady = hireOpt.ready_at_days;
    const upReady = upskillOpt.ready_at_days;
    const ready = Math.max(hireReady, upReady);
    const meets = ready <= input.deadline_days;
    const totalCost = hireOpt.cost_usd + upskillOpt.cost_usd;
    const rows = skills.map((r) => {
      const h = hireOpt.skill_coverage.find((x) => norm(x.skill) === norm(r.skill));
      const u = upskillOpt.skill_coverage.find((x) => norm(x.skill) === norm(r.skill));
      const viaHire = h && (h.coverage === "verified" || h.coverage === "conditional");
      const viaUpskill = u && u.coverage !== "absent";
      const best = [h, u].find((x) => x && (x.coverage === "verified" || x.coverage === "conditional"));
      const cur = Math.max(h?.current_proficiency ?? 0, u?.current_proficiency ?? 0) || null;
      return coverageRow(
        r,
        best ? best.coverage : "gap",
        cur,
        r.min_proficiency,
        best ? `covered by ${best.source}` : "no hybrid path"
      );
    });
    const s = summarize(rows);
    const phaseNote = hireReady > upReady
      ? `Upskill track is ready at day ${upReady}; the hire completes at day ${hireReady}. The team is NOT fully ready until day ${ready} — phased availability: ${upskillOpt.subject} at day ${upReady}, full team at day ${ready}.`
      : upReady > hireReady
        ? `Hire track is ready at day ${hireReady}; upskill completes at day ${upReady}. Phased availability: ${hireOpt.subject} at day ${hireReady}, full team at day ${ready}.`
        : `Both tracks finish at day ${ready}.`;
    const status: PlannerStatus = meets ? "conditional" : "infeasible";
    options.push({
      id: "hybrid",
      label: "Hybrid (hire + upskill)",
      status,
      status_reason: meets
        ? `${phaseNote} Readiness is conditional on both tracks executing (hire completing + training verifying).`
        : `${phaseNote} The latest required finish (day ${ready}) exceeds the ${input.deadline_days}-day window, so the hybrid is NOT ready by the deadline — never clamped.`,
      skill_coverage: rows,
      verified_coverage_pct: s.verified_coverage_pct,
      conditional_coverage_pct: s.conditional_coverage_pct,
      mandatory_satisfied: s.mandatory_satisfied,
      mandatory_missing: s.mandatory_missing,
      timeline: [
        { name: "Hire track", kind: "hire", duration_days: hireReady, parallel: true },
        { name: "Upskill track", kind: "training", duration_days: upReady, parallel: true },
      ],
      ready_at_days: ready,
      meets_deadline: meets,
      cost_usd: totalCost,
      budget_satisfied: totalCost <= input.budget_usd,
      dependency_risk: "high",
      constraints_satisfied: [
        "Both tracks' mandatory coverage combined",
        "Phased availability described explicitly (not 'entire hybrid ready')",
      ],
      constraints_violated: meets ? [] : [`Latest finish day ${ready} > deadline ${input.deadline_days}`],
      rationale: `Hybrid combines hire (ready day ${hireReady}) and upskill (ready day ${upReady}); it is ready only at the latest finish (day ${ready}) because both tracks must finish (item 18). ${meets ? "It satisfies the window but stays conditional on execution." : "It fails the window because the latest finish cannot be clamped."}`,
      subject: `${hireOpt.subject} + ${upskillOpt.subject}`,
    });
  }

  const decision_table = options.map((o) => ({
    option_id: o.id,
    cost_usd: o.cost_usd,
    ready_at_days: o.ready_at_days,
    verified_coverage_pct: o.verified_coverage_pct,
    conditional_coverage_pct: o.conditional_coverage_pct,
    status: o.status,
  }));

  return {
    scenario: input,
    assumptions: a,
    options,
    decision_table,
    note: "Deterministic constrained planner: skill-by-skill coverage, mandatory-skill gates, sequential/parallel timing with the actual latest finish (never clamped), and a status vocabulary of feasible / conditional / infeasible / insufficient_data. Cost and duration are explicit assumptions; the model may explain but never invent the numbers.",
  };
}

/** Public entry: plan against an internal population + candidate pipeline. */
export function planStaffing(
  input: ScenarioInput,
  population: Person[],
  candidates: Candidate[],
  assumptions: Assumptions = DEFAULT_ASSUMPTIONS
): PlanResult {
  return planSummary(input, assumptions, population, candidates);
}
