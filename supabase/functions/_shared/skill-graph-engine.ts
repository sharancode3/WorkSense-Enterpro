// ---------------------------------------------------------------------------
// WorkSense Skill Intelligence Graph engine — the shared, deterministic core.
// Zero LLM calls. Imported by backend functions (Recruitment, Onboarding,
// Recommendation Hub) — never recomputed per page view; results are persisted
// into digital_twins.computed_fits[] and, for skill-match, the durable
// skill_fits table.
//
// Phase 8: every fit is versioned against the engine, the person's evidence
// and the requisition content; cached results are marked stale when any of
// them change. Adjacency and transferable support carry explicit limitations
// (never direct equivalence). The evidence section counts DISTINCT artifacts,
// not skill assertions.
// ---------------------------------------------------------------------------

export type VerificationRigor = "low" | "medium" | "high";

/** Bump when the scoring semantics change — stale cached fits are recomputed. */
export const ENGINE_VERSION = "2";

export interface SkillClaim {
  name: string;
  proficiency: number;
  evidence_source: string;
  verification_rigor: VerificationRigor;
}

export type EdgeType = "PREREQUISITE_OF" | "ADJACENT_TO" | "TRANSFERABLE_TO";

export interface GraphEdge {
  target_skill: string;
  type: EdgeType;
  weight: number; // 0.0 - 1.0
}

export interface GraphSkill {
  skill: string;
  category: string;
  outgoing_edges: GraphEdge[];
}

export interface RequiredSkill {
  skill: string;
  target_proficiency: number;
}

export type Classification = "direct" | "adjacent" | "transferable" | "gap";

export interface FitItem {
  skill: string;
  classification: Classification;
  required_proficiency: number;
  candidate_proficiency: number | null;
  edge: { from_skill: string; type: EdgeType; weight: number } | null;
  contribution: number | null;
  reason: string;
  /** Phase 8: honest limitation of this classification (never equivalence).
   *  Optional so legacy generated fits remain valid. */
  limitation?: string | null;
}

export interface FitRecord {
  target_type: "requisition";
  target_id: string;
  target_title: string;
  scenario: "current" | "future";
  score: number;
  sections: {
    direct: { value: number; items: FitItem[] };
    adjacent: { value: number; items: FitItem[] };
    evidence: { value: number; artifact_count: number; threshold: number };
    seniority: { value: number; candidate_level: number; role_level: number };
  };
  classification: {
    direct: FitItem[];
    adjacent: FitItem[];
    transferable: FitItem[];
    gaps: FitItem[];
  };
  /** Phase 8 / Batch E: what the fit is versioned against (stale detection).
   *  Optional so legacy generated fits remain valid; missing versions are
   *  treated as stale. graph + context were added in Batch E — fits computed
   *  before them are recomputed once. */
  versions?: {
    engine: string;
    evidence: string;
    requisition: string;
    graph?: string;
    context?: string;
  };
  /** Phase 8: named horizon + assumption the fit was computed under. */
  assumptions?: {
    horizon: string;
    note: string;
  };
  computed_at: string;
}

// Validated weights — do not change.
export const MATCH_WEIGHTS = {
  direct: 0.5,
  adjacent: 0.25,
  evidence: 0.15,
  seniority: 0.1,
} as const;

export const DEFAULT_EVIDENCE_THRESHOLD = 5;

const norm = (s: string) => s.trim().toLowerCase();

export function findEdge(
  skillGraph: GraphSkill[],
  from: string,
  to: string,
  type: EdgeType
): GraphEdge | null {
  const node = skillGraph.find((n) => norm(n.skill) === norm(from));
  const edge = node?.outgoing_edges.find(
    (e) => norm(e.target_skill) === norm(to) && e.type === type
  );
  return edge ?? null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Deterministic FNV-1a hex (uniquely named to avoid bundle collisions). */
export function graphFnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Version hash over the requisition's skill content (phase 8 stale check). */
export function requisitionContentHash(
  requiredSkills: RequiredSkill[],
  futureSkills: RequiredSkill[],
  seniorityLevel: number
): string {
  const payload = [
    ...(requiredSkills ?? []).map((s) => `${s.skill}|${s.target_proficiency}`).sort(),
    ...(futureSkills ?? []).map((s) => `future:${s.skill}|${s.target_proficiency}`).sort(),
    `level:${seniorityLevel}`,
  ].join(";");
  return graphFnv1aHex(payload);
}

/** Version hash over the person's resolved skill claims (evidence version). */
export function claimHash(claims: SkillClaim[]): string {
  const payload = (claims ?? [])
    .map((c) => `${c.name}|${c.proficiency}|${c.evidence_source}|${c.verification_rigor}`)
    .sort()
    .join(";");
  return graphFnv1aHex(payload);
}

/** Batch E (E3): version hash over the whole graph (nodes + typed edges), so a
 *  taxonomy change invalidates fits that relied on those edges. */
export function graphContentHash(
  graph: { skill: string; outgoing_edges: { target_skill: string; type: string; weight: number }[] }[]
): string {
  const payload = (graph ?? [])
    .flatMap((n) => [
      `node:${n.skill}`,
      ...(n.outgoing_edges ?? []).map((e) => `${n.skill}|${e.type}|${e.target_skill}|${e.weight}`),
    ])
    .sort()
    .join(";");
  return graphFnv1aHex(payload);
}

/** Batch E (E3): person-level context that changes the score but is not part
 *  of the claim set — seniority and the number of independent evidence
 *  artifacts behind the claims. */
export function personContextHash(candidateLevel: number, evidenceArtifactCount: number | undefined, claimCount: number): string {
  const artifacts = evidenceArtifactCount !== undefined ? evidenceArtifactCount : claimCount;
  return graphFnv1aHex(`level:${candidateLevel}|artifacts:${artifacts}`);
}

/** Phase 8 / Batch E: a cached fit is stale when the engine, the person's
 *  evidence, the requisition content, the skill graph, or the person-level
 *  context (seniority / evidence artifact count) changed since it was
 *  computed. */
export function fitIsStale(
  fit: FitRecord | null,
  current: { engine: string; evidence: string; requisition: string; graph?: string; context?: string }
): boolean {
  if (!fit) return true;
  const v = fit.versions;
  if (!v) return true; // pre-version fits are always stale
  if (v.engine !== current.engine || v.evidence !== current.evidence || v.requisition !== current.requisition) return true;
  // Batch E: legacy fits lack graph/context fingerprints -> stale once.
  if (current.graph !== undefined && (v.graph ?? undefined) !== current.graph) return true;
  if (current.context !== undefined && (v.context ?? undefined) !== current.context) return true;
  return false;
}

const HORIZON_LABEL: Record<string, string> = {
  current: "Current requirements — as recorded on the requisition today.",
  future: "12–24 month outlook — derived from the requisition's future_skills. Assumption: these skills are the expected demand; edit the requisition to change them.",
};

export function computeFit(params: {
  candidateSkills: SkillClaim[];
  candidateLevel: number;
  requiredSkills: RequiredSkill[];
  roleLevel: number;
  skillGraph: GraphSkill[];
  threshold?: number;
  target: { type: "requisition"; id: string; title: string };
  scenario: "current" | "future";
  computedAt?: string;
  /** Phase 8: distinct artifact count behind the claims (dedup, never
   *  one-per-assertion). Falls back to claim count when not supplied. */
  evidenceArtifactCount?: number;
  /** Phase 8: requisition content hash (stale detection). */
  requisitionVersion?: string;
}): FitRecord {
  const threshold = params.threshold ?? DEFAULT_EVIDENCE_THRESHOLD;
  const graph = params.skillGraph;

  const directItems: FitItem[] = [];
  const adjacentItems: FitItem[] = [];
  const transferableItems: FitItem[] = [];
  const gapItems: FitItem[] = [];
  const directValues: number[] = [];
  const adjacentValues: number[] = [];

  let ownedCount = 0;
  for (const req of params.requiredSkills) {
    const own = params.candidateSkills.find((s) => norm(s.name) === norm(req.skill));
    const ownProficiency = own?.proficiency ?? 0;

    // S_direct: min(1, candidate/required) across ALL required skills — 0 for
    // skills not owned; partial proficiency still contributes its ratio.
    const ratio = own ? Math.min(1, ownProficiency / req.target_proficiency) : 0;
    directValues.push(ratio);

    if (own) {
      ownedCount++;
      if (ownProficiency >= req.target_proficiency) {
        directItems.push({
          skill: req.skill,
          classification: "direct",
          required_proficiency: req.target_proficiency,
          candidate_proficiency: ownProficiency,
          edge: null,
          contribution: ratio,
          reason: `Holds ${req.skill} at ${ownProficiency}/${req.target_proficiency} required.`,
          limitation: null,
        });
      } else {
        directItems.push({
          skill: req.skill,
          classification: "direct",
          required_proficiency: req.target_proficiency,
          candidate_proficiency: ownProficiency,
          edge: null,
          contribution: ratio,
          reason: `Holds ${req.skill} at ${ownProficiency}/${req.target_proficiency} — below the required bar.`,
          limitation: null,
        });
      }
      continue;
    }

    // Adjacent: no direct skill, but a real ADJACENT_TO edge exists (with the
    // candidate's proficiency weighting the edge). Never a direct equivalence.
    let bestAdj: { from: string; edge: GraphEdge; value: number } | null = null;
    for (const claim of params.candidateSkills) {
      const edge = findEdge(graph, claim.name, req.skill, "ADJACENT_TO");
      if (edge) {
        const value = (claim.proficiency / 5) * edge.weight;
        if (!bestAdj || value > bestAdj.value) bestAdj = { from: claim.name, edge, value };
      }
    }
    if (bestAdj) {
      adjacentValues.push(bestAdj.value);
      adjacentItems.push({
        skill: req.skill,
        classification: "adjacent",
        required_proficiency: req.target_proficiency,
        candidate_proficiency: ownProficiency || null,
        edge: { from_skill: bestAdj.from, type: "ADJACENT_TO", weight: bestAdj.edge.weight },
        contribution: bestAdj.value,
        reason: `No direct ${req.skill}; backed by ${bestAdj.from} → ${req.skill} (ADJACENT_TO, ${bestAdj.edge.weight.toFixed(2)}).`,
        limitation: "Adjacent support is NOT direct equivalence: this person has no evidence for the required skill itself. Confirm real capability before relying on it.",
      });
      continue;
    }

    // Transferable: no direct/adjacent edge, but a TRANSFERABLE_TO edge or a
    // strong same-category relationship exists.
    let transfer: { from: string; edge: GraphEdge | null; via: string } | null = null;
    for (const claim of params.candidateSkills) {
      const edge = findEdge(graph, claim.name, req.skill, "TRANSFERABLE_TO");
      if (edge) {
        transfer = { from: claim.name, edge, via: "edge" };
        break;
      }
      if (!transfer) {
        const ownNode = graph.find((n) => norm(n.skill) === norm(claim.name));
        const reqNode = graph.find((n) => norm(n.skill) === norm(req.skill));
        if (ownNode && reqNode && ownNode.category && ownNode.category === reqNode.category) {
          transfer = { from: claim.name, edge: null, via: `same category (${ownNode.category})` };
        }
      }
    }
    if (transfer) {
      transferableItems.push({
        skill: req.skill,
        classification: "transferable",
        required_proficiency: req.target_proficiency,
        candidate_proficiency: ownProficiency || null,
        edge: transfer.edge
          ? { from_skill: transfer.from, type: "TRANSFERABLE_TO", weight: transfer.edge.weight }
          : null,
        contribution: null,
        reason: transfer.edge
          ? `No direct or adjacent path; ${transfer.from} → ${req.skill} is transferable.`
          : `No direct or adjacent path; ${transfer.from} shares the ${transfer.via}.`,
        limitation: "Transferable support is the weakest signal: it does not establish any proficiency in the required skill and contributes no points to the score. Treat it as a development candidate, not capability.",
      });
      continue;
    }

    gapItems.push({
      skill: req.skill,
      classification: "gap",
      required_proficiency: req.target_proficiency,
      candidate_proficiency: ownProficiency || null,
      edge: null,
      contribution: null,
      reason: `No direct, adjacent, or transferable path found for ${req.skill}.`,
      limitation: null,
    });
  }

  const S_direct =
    directValues.length > 0
      ? directValues.reduce((a, b) => a + b, 0) / directValues.length
      : 0;

  const missing = params.requiredSkills.length - ownedCount; // skills not owned at all
  const S_adjacent =
    missing === 0
      ? 1 // nothing missing to be adjacent to
      : adjacentValues.length > 0
        ? adjacentValues.reduce((a, b) => a + b, 0) / missing
        : 0;

  // Phase 8: evidence counts DISTINCT artifacts (deduped by source), never one
  // point per skill assertion. Fallback to the claim count for legacy callers.
  const artifactCount =
    params.evidenceArtifactCount !== undefined
      ? params.evidenceArtifactCount
      : params.candidateSkills.filter((s) => s.verification_rigor === "high" || s.verification_rigor === "medium").length;
  const S_evidence = Math.min(1, artifactCount / threshold);

  const S_seniority = Math.max(0, 1 - 0.2 * Math.abs(params.candidateLevel - params.roleLevel));

  const score =
    MATCH_WEIGHTS.direct * S_direct +
    MATCH_WEIGHTS.adjacent * S_adjacent +
    MATCH_WEIGHTS.evidence * S_evidence +
    MATCH_WEIGHTS.seniority * S_seniority;

  return {
    target_type: params.target.type,
    target_id: params.target.id,
    target_title: params.target.title,
    scenario: params.scenario,
    score: round3(score),
    sections: {
      direct: { value: round3(S_direct), items: directItems },
      adjacent: { value: round3(S_adjacent), items: adjacentItems },
      evidence: { value: round3(S_evidence), artifact_count: artifactCount, threshold },
      seniority: {
        value: round3(S_seniority),
        candidate_level: params.candidateLevel,
        role_level: params.roleLevel,
      },
    },
    classification: {
      direct: directItems,
      adjacent: adjacentItems,
      transferable: transferableItems,
      gaps: gapItems,
    },
    versions: {
      engine: ENGINE_VERSION,
      evidence: claimHash(params.candidateSkills),
      requisition: params.requisitionVersion ?? "unknown",
      graph: graphContentHash(graph),
      context: personContextHash(params.candidateLevel, params.evidenceArtifactCount, params.candidateSkills.length),
    },
    assumptions: {
      horizon: params.scenario === "future" ? "12–24 month outlook" : "Current",
      note: HORIZON_LABEL[params.scenario],
    },
    computed_at: params.computedAt ?? new Date().toISOString(),
  };
}

/** Cache key for computed_fits[] entries. */
export function fitKey(record: { target_type: string; target_id: string; scenario: string }) {
  return `${record.target_type}|${record.target_id}|${record.scenario}`;
}
