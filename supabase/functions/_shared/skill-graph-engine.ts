// ---------------------------------------------------------------------------
// WorkSense Skill Intelligence Graph engine — the shared, deterministic core.
// Zero LLM calls. Imported by backend functions (Recruitment, Onboarding,
// Recommendation Hub) — never recomputed per page view; results are persisted
// into the subject's digital_twins.computed_fits[].
// ---------------------------------------------------------------------------

export type VerificationRigor = "low" | "medium" | "high";

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

  const artifactCount = params.candidateSkills.filter(
    (s) => s.verification_rigor === "high" || s.verification_rigor === "medium"
  ).length;
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
    computed_at: params.computedAt ?? new Date().toISOString(),
  };
}

/** Cache key for computed_fits[] entries. */
export function fitKey(record: { target_type: string; target_id: string; scenario: string }) {
  return `${record.target_type}|${record.target_id}|${record.scenario}`;
}
