// ---------------------------------------------------------------------------
// Performance Intelligence — deterministic aggregation + rule-based analysis.
// Zero LLM. Builds an evidence-bound picture for a reviewer conversation:
//   - source_facts: verbatim rows from records (dated, attributed).
//   - goal_stats / feedback_stats: directional context ONLY, never a verdict.
//   - contradictions: visible tensions between records that a human must
//     reconcile (positive rating vs recorded concerns, declining goals, etc).
//   - sparse_evidence: explicit flags when evidence is thin.
//   - inferred_themes: labeled as INFERENCE (rule-based), never diagnosis.
// The model later writes a narrative strictly ON TOP of these facts and must
// cite them; it cannot invent metrics, examples, or causal diagnoses.
// ---------------------------------------------------------------------------

export interface PerfFeedback {
  sentiment?: string; // positive | negative | neutral | mixed
  text?: string;
  date?: string | null;
}

export interface PerfCycle {
  cycle: string;
  rating?: string;
  goals_met?: number | null;
  feedback?: PerfFeedback[];
  summary?: string;
}

export interface PerfSkill {
  name: string;
  proficiency?: number;
  verification_rigor?: string;
}

export interface PerformanceInput {
  performance_history?: PerfCycle[];
  verified_skills?: PerfSkill[];
  observations?: { metric: string; period: string; value: number | null; missing: boolean }[];
  evidence_items?: { source_type?: string; quote?: string; captured_at?: string }[];
  seeking_growth?: boolean;
  computed_at?: string;
}

export interface PerformanceSourceFact {
  ref: string;
  source: string;
  fact: string;
  /** Phase 7: the record period the fact refers to (resolvable supporting
   *  evidence), e.g. "2026-H1" or a captured date, or null when n/a. */
  period: string | null;
}

export interface PerformanceFacts {
  source_facts: PerformanceSourceFact[];
  goal_stats: { cycles: number; avg: number | null; min: number | null; max: number | null; note: string };
  feedback_stats: {
    total: number;
    positive: number;
    negative: number;
    mixed: number;
    neutral: number;
    by_cycle: { cycle: string; positive: number; negative: number }[];
    note: string;
  };
  evidence_summary: { source_type: string; count: number }[];
  contradictions: { title: string; evidence: string[] }[];
  sparse_evidence: { flags: string[] };
  inferred_themes: { theme: string; basis: string[]; confidence_note: string }[];
  source_version_hash: string;
  // Phase 7 additions:
  history_state: "none" | "partial" | "adequate";
  stale_evidence: { kind: string; detail: string }[];
  evidence_gaps: { skill: string; proficiency: number | null; gap: string }[];
  work_artifacts: { source_type: string; quote: string; captured_at: string | null; period: string | null }[];
}

const RATING_ORDER: Record<string, number> = {
  "Needs Improvement": 1,
  "On Track": 2,
  "Meets Expectations": 3,
  "Exceeds Expectations": 4,
  "Exceptional": 5,
};

/** Phase 7: stale-evidence thresholds (calendar months before computed_at). */
export const STALE_FEEDBACK_MONTHS = 18;
export const STALE_WORK_EVIDENCE_MONTHS = 12;
export const PERFORMANCE_HISTORY_MIN_CYCLES = 2;

function monthsBetween(from: string, toIso: string): number {
  const src = /^\d{4}-\d{2}$/.test(String(from)) ? `${from}-01` : String(from);
  const f = new Date(src);
  const t = new Date(toIso);
  if (isNaN(f.getTime())) return 0;
  return (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth());
}

/** Phase 7 (spec item 17): validate that every source citation in a claim
 *  exists in the source-fact refs. Accepts "[S3]" or bare "S3" (the model
 *  emits both). Returns the list of unsupported refs (empty = ok). */
export function validatePerformanceCitations(claims: string[], sourceRefs: string[]): string[] {
  const valid = new Set(sourceRefs);
  const unsupported = new Set<string>();
  for (const claim of claims) {
    const refs = [...String(claim ?? "").matchAll(/(?:\[?\s*S(\d+)\s*\]?)/gi)].map((m) => `S${m[1]}`);
    if (refs.length === 0) unsupported.add(`claim without any source citation: "${String(claim).slice(0, 80)}…"`);
    for (const ref of refs) if (!valid.has(ref)) unsupported.add(`unknown citation ${ref} in "${String(claim).slice(0, 80)}…"`);
  }
  return [...unsupported];
}

export function computePerformanceFacts(input: PerformanceInput): PerformanceFacts {
  const history = (input.performance_history ?? []).filter((h) => h && h.cycle);
  const cycles = history.length;
  const computedAt = input.computed_at ?? new Date().toISOString();

  // --- source facts (verbatim rows, attributed) ------------------------------
  const source_facts: PerformanceSourceFact[] = [];
  const periodFor = (h: PerfCycle) => h.cycle;
  for (const h of history) {
    if (h.rating) source_facts.push({ ref: `S${source_facts.length + 1}`, source: `PERFORMANCE:${h.cycle}`, fact: `Rating "${h.rating}" recorded for cycle ${h.cycle}.`, period: periodFor(h) });
    if (typeof h.goals_met === "number") source_facts.push({ ref: `S${source_facts.length + 1}`, source: `PERFORMANCE:${h.cycle}`, fact: `Goal attainment ${h.goals_met}% recorded for cycle ${h.cycle} (review goals and difficulty in conversation — the raw number is directional context).`, period: periodFor(h) });
    for (const f of h.feedback ?? []) {
      if (f?.text) {
        const d = f.date ? ` (dated ${f.date})` : ` (cycle ${h.cycle})`;
        source_facts.push({ ref: `S${source_facts.length + 1}`, source: `FEEDBACK:${h.cycle}`, fact: `Feedback [${f.sentiment ?? "neutral"}]: "${f.text}"${d}.`, period: f.date ?? periodFor(h) });
      }
    }
    if (h.summary) source_facts.push({ ref: `S${source_facts.length + 1}`, source: `PERFORMANCE:${h.cycle}`, fact: `Cycle summary: "${h.summary}".`, period: periodFor(h) });
  }

  const skills = input.verified_skills ?? [];
  for (const s of skills) {
    if (s?.name) {
      source_facts.push({
        ref: `S${source_facts.length + 1}`,
        source: "SKILL_ASSESSMENT",
        fact: `Skill assessment: ${s.name} (proficiency ${s.proficiency ?? "n/a"}/5, verification rigor "${s.verification_rigor ?? "not stated"}").`,
        period: null,
      });
    }
  }

  const evCounts = new Map<string, number>();
  for (const e of input.evidence_items ?? []) {
    if (!e?.source_type) continue;
    evCounts.set(e.source_type, (evCounts.get(e.source_type) ?? 0) + 1);
  }
  const evidence_summary = [...evCounts.entries()].map(([source_type, count]) => ({ source_type, count })).sort((a, b) => b.count - a.count);
  const workEvidence = (input.evidence_items ?? []).filter((e) => e?.quote);
  const work_artifacts = workEvidence.slice(0, 6).map((e) => ({
    source_type: e.source_type ?? "work_sample",
    quote: e.quote ?? "",
    captured_at: e.captured_at ?? null,
    period: e.captured_at ? e.captured_at.slice(0, 7) : null,
  }));
  for (const e of workEvidence.slice(0, 4)) {
    source_facts.push({ ref: `S${source_facts.length + 1}`, source: `EVIDENCE:${e.source_type ?? "work_sample"}`, fact: `Work evidence: "${e.quote}"${e.captured_at ? ` (captured ${e.captured_at.slice(0, 10)})` : ""}.`, period: e.captured_at ? e.captured_at.slice(0, 7) : null });
  }

  // --- goal stats (directional context, not a verdict) -----------------------
  const goals = history.map((h) => h.goals_met).filter((g): g is number => typeof g === "number");
  const goal_stats: PerformanceFacts["goal_stats"] = {
    cycles: goals.length,
    avg: goals.length > 0 ? +(goals.reduce((a, b) => a + b, 0) / goals.length).toFixed(1) : null,
    min: goals.length > 0 ? Math.min(...goals) : null,
    max: goals.length > 0 ? Math.max(...goals) : null,
    note: "Goal attainment is directional context — review the underlying goals, difficulty and evidence in the conversation. An unqualified average is not a performance verdict.",
  };

  // --- feedback stats --------------------------------------------------------
  const fb = { positive: 0, negative: 0, mixed: 0, neutral: 0, total: 0 };
  const byCycleMap = new Map<string, { cycle: string; positive: number; negative: number }>();
  for (const h of history) {
    const acc = { cycle: h.cycle, positive: 0, negative: 0 };
    for (const f of h.feedback ?? []) {
      const s = f?.sentiment ?? "neutral";
      fb.total++;
      if (s === "positive") fb.positive++;
      else if (s === "negative") fb.negative++;
      else if (s === "mixed") fb.mixed++;
      else fb.neutral++;
      if (s === "positive") acc.positive++;
      if (s === "negative") acc.negative++;
    }
    if (acc.positive > 0 || acc.negative > 0) byCycleMap.set(h.cycle, acc);
  }
  const feedback_stats: PerformanceFacts["feedback_stats"] = {
    ...fb,
    by_cycle: [...byCycleMap.values()],
    note: "Sentiment counts are directional context for the conversation — they are not a performance score and cannot replace reading the actual feedback text.",
  };

  // --- contradictions (visible tensions a human must reconcile) --------------
  const contradictions: { title: string; evidence: string[] }[] = [];
  const lastRating = history.length > 0 ? history[history.length - 1].rating : "";
  const lastOrder = RATING_ORDER[lastRating] ?? 0;
  if (fb.negative > 0 && lastOrder >= 2) {
    contradictions.push({
      title: "Recorded concerns vs. positive formal rating",
      evidence: [
        `${fb.negative} feedback entr${fb.negative === 1 ? "y" : "ies"} flag concerns, while the latest formal rating is "${lastRating || "n/a"}".`,
        "Reconcile the tension in the review conversation — do not assume which side is right.",
      ],
    });
  }
  if (goals.length >= 2 && goals[goals.length - 1] < goals[0] - 5) {
    contradictions.push({
      title: "Declining goal attainment",
      evidence: [
        `Goal attainment moved ${goals[0]}% → ${goals[goals.length - 1]}% between the first and latest recorded cycle.`,
        "Establish the cause (scope change, difficulty, capacity, external factors) before concluding anything.",
      ],
    });
  }
  const engTrend = engagementDirection(input.observations ?? []);
  if (engTrend === "down" && (fb.negative > 0 || fb.mixed > 0)) {
    contradictions.push({
      title: "Engagement decline alongside recorded concerns",
      evidence: [
        "Engagement observations trend downward while feedback contains concerns.",
        "Investigate workload and context first — correlation is not a diagnosis.",
      ],
    });
  }

  // --- sparse evidence flags --------------------------------------------------
  const flags: string[] = [];
  if (cycles < 2) flags.push(`Only ${cycles} performance cycle(s) on record — trend claims are weak.`);
  if (fb.total < 2) flags.push(`Few dated feedback entries (${fb.total}) — read what exists, do not average silence.`);
  if (skills.length < 2) flags.push(`Limited skill-assessment evidence (${skills.length} skill record(s)).`);
  const obsPresent = (input.observations ?? []).filter((o) => !o.missing && o.value !== null).length;
  const obsTotal = (input.observations ?? []).length;
  if (obsTotal > 0 && obsPresent / obsTotal < 0.6) {
    flags.push(`Observation history is incomplete (${Math.round((obsPresent / obsTotal) * 100)}% of ${obsTotal} slots present).`);
  }
  if (workEvidence.length === 0) flags.push("No work-evidence items attached — strengths claims cannot cite concrete outputs.");

  // --- Phase 7: history state (insufficient vs adequate) ----------------------
  const history_state: PerformanceFacts["history_state"] = cycles === 0 ? "none" : cycles < PERFORMANCE_HISTORY_MIN_CYCLES ? "partial" : "adequate";

  // --- Phase 7: stale evidence (spec item 13) ---------------------------------
  const stale_evidence: { kind: string; detail: string }[] = [];
  for (const h of history) {
    for (const f of h.feedback ?? []) {
      if (f?.date && monthsBetween(f.date, computedAt) > STALE_FEEDBACK_MONTHS) {
        stale_evidence.push({ kind: "stale_feedback", detail: `Feedback from ${f.date} is over ${STALE_FEEDBACK_MONTHS} months old (cycle ${h.cycle}).` });
      }
    }
  }
  for (const e of workEvidence) {
    if (e.captured_at && monthsBetween(e.captured_at.slice(0, 10), computedAt) > STALE_WORK_EVIDENCE_MONTHS) {
      stale_evidence.push({ kind: "stale_work_evidence", detail: `Work evidence captured ${e.captured_at.slice(0, 10)} is over ${STALE_WORK_EVIDENCE_MONTHS} months old.` });
    }
  }
  if (stale_evidence.length > 0) flags.push(`${stale_evidence.length} record(s) are stale — treat them as historical, not current, and re-verify in conversation.`);

  // --- Phase 7: evidence gaps for development actions (spec item 15) ----------
  const evidence_gaps: { skill: string; proficiency: number | null; gap: string }[] = [];
  for (const s of skills) {
    if (!s?.name) continue;
    const rigor = s.verification_rigor ?? "not stated";
    if (rigor === "claimed" || rigor === "low" || rigor === "not stated" || rigor === "") {
      evidence_gaps.push({ skill: s.name, proficiency: s.proficiency ?? null, gap: `"${s.name}" has no verified evidence — only a ${rigor === "not stated" || rigor === "" ? "self-reported/claimed" : rigor}-rigor record. Development claims must attach a concrete, verifiable artifact.` });
    } else if ((s.proficiency ?? 0) < 3) {
      evidence_gaps.push({ skill: s.name, proficiency: s.proficiency ?? null, gap: `"${s.name}" is assessed below the working bar (${s.proficiency}/5) — a development action should name the measurable evidence that would demonstrate growth.` });
    }
  }

  // --- inferred themes (labeled inference, not diagnosis) ---------------------
  const inferred_themes: { theme: string; basis: string[]; confidence_note: string }[] = [];
  if (fb.negative > 0 && engTrend === "down") {
    inferred_themes.push({
      theme: "Possible workload or engagement-pressure theme (INFERRED)",
      basis: ["Recorded concerns in feedback", "Downward engagement observation trend"],
      confidence_note: "Rule-based inference. Requires a conversation to confirm; it is not a diagnosis and not grounds for any action by itself.",
    });
  }
  if (goals.length > 0 && goals.every((g) => g >= 85)) {
    inferred_themes.push({
      theme: "Sustained high goal attainment (FACT-based observation)",
      basis: [`Goal attainment ${Math.min(...goals)}–${Math.max(...goals)}% across ${goals.length} cycle(s)`],
      confidence_note: "Directly supported by recorded goal figures.",
    });
  }
  if (input.seeking_growth === true) {
    inferred_themes.push({
      theme: "Reported development interest (INFERRED — self-reported flag)",
      basis: ["seeks_growth signal recorded"],
      confidence_note: "Self-reported and time-boxed; treat as a growth-planning input, not a risk signal.",
    });
  }
  const highRigor = skills.filter((s) => s?.verification_rigor === "high").length;
  if (skills.length > 0 && highRigor === skills.length) {
    inferred_themes.push({
      theme: "Skill evidence is uniformly high-rigor (FACT-based observation)",
      basis: [`${highRigor}/${skills.length} skill assessments marked high rigor`],
      confidence_note: "Reflects verification metadata, not task quality.",
    });
  }

  return {
    source_facts,
    goal_stats,
    feedback_stats,
    evidence_summary,
    contradictions,
    sparse_evidence: { flags },
    inferred_themes,
    source_version_hash: performanceSourceHash(input),
    history_state,
    stale_evidence,
    evidence_gaps,
    work_artifacts,
  };
}

function engagementDirection(obs: { metric: string; period: string; value: number | null; missing: boolean }[]): "up" | "down" | "flat" | "insufficient" {
  const vals = (obs ?? [])
    .filter((o) => o.metric === "engagement" && !o.missing && o.value !== null)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((o) => o.value as number);
  if (vals.length < 4) return "insufficient";
  const half = Math.floor(vals.length / 2);
  const first = vals.slice(0, half).reduce((s, v) => s + v, 0) / half;
  const second = vals.slice(-half).reduce((s, v) => s + v, 0) / half;
  if (first <= 0) return "flat";
  const delta = (second - first) / first;
  return delta < -0.03 ? "down" : delta > 0.03 ? "up" : "flat";
}

// Stable version hash over the performance-relevant source rows. When this
// changes, any cached narrative built from the old rows is invalidated.
export function performanceSourceHash(input: PerformanceInput): string {
  const payload = {
    history: (input.performance_history ?? []).map((h) => ({
      cycle: h.cycle,
      rating: h.rating ?? null,
      goals_met: h.goals_met ?? null,
      feedback: (h.feedback ?? []).map((f) => [f?.sentiment ?? "", f?.text ?? "", f?.date ?? ""]),
      summary: h.summary ?? null,
    })),
    skills: (input.verified_skills ?? []).map((s) => [s?.name ?? "", s?.proficiency ?? null, s?.verification_rigor ?? ""]),
    observations: (input.observations ?? [])
      .map((o) => `${o.metric}|${o.period}|${String(o.value)}|${o.missing ? 1 : 0}`)
      .sort(),
    evidence: (input.evidence_items ?? [])
      .map((e) => `${e?.source_type ?? ""}|${e?.quote ?? ""}|${e?.captured_at ?? ""}`)
      .sort(),
    seeking_growth: input.seeking_growth === true,
  };
  return fnv1aHex(JSON.stringify(payload));
}

// FNV-1a 32-bit, hex — deterministic across platforms (shared with review index).
export function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
