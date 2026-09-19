import { supabase } from "@/integrations/supabase/client";

// Frontend mirror of the engine's FitRecord shape (persisted in
// digital_twins.computed_fits[] and returned by the skill-match function).
// Phase 9: requirement-centered scoring — see skill-graph-engine.ts.

export type FitClassification =
  | "verified_direct"
  | "provisional_direct"
  | "below_target"
  | "adjacent_support"
  | "transferable_foundation"
  | "missing";

export type FitRelationship = "direct" | "adjacent" | "transferable" | "none";

export interface FitItem {
  skill: string;
  classification: FitClassification;
  relationship: FitRelationship;
  mandatory: boolean;
  required_proficiency: number;
  candidate_proficiency: number | null;
  effective_proficiency: number;
  gap: number;
  evidence_state: string | null;
  evidence_source: string | null;
  freshness_days: number | null;
  evidence_factor: number;
  verified_contribution: number | null;
  contribution: number | null;
  verified: boolean;
  provisional: boolean;
  next_action: string;
  edge: { from_skill: string; type: string; weight: number } | null;
  reason: string;
  limitation?: string | null;
}

export interface FitRecord {
  target_type: string;
  target_id: string;
  target_title: string;
  scenario: "current" | "future";
  /** Verified readiness — accepted independent evidence only. */
  score: number;
  /** Provisional profile match — all live claims, evidence-attenuated. */
  profile_match: number;
  /** Weighted mean evidence factor over contributing requirements. */
  evidence_confidence: number;
  mandatory_gate: {
    met: boolean;
    unmet_skills: string[];
    count: number;
    note: string;
  };
  contextual_alignment: {
    candidate_level: number;
    role_level: number;
    note: string;
  };
  scoring: {
    requirements: FitItem[];
    mandatory: { count: number; met: number; unmet: number; unmet_skills: string[]; gated: boolean; readiness: number | null };
    preferred: { count: number; readiness: number | null } | null;
    verified: { readiness: number };
    provisional: { readiness: number };
    confidence: number;
    group_weights: { mandatory: number; preferred: number };
    evidence_artifacts: { count: number; threshold: number };
    resolved_from: "current" | "resolved-future";
    derivation?: { kept: string[]; added: string[]; raised: string[]; obsolete: string[] };
  };
  classification: Record<FitClassification, FitItem[]>;
  versions?: { engine: string; evidence: string; requisition: string; graph?: string; context?: string; plan?: string };
  assumptions?: { horizon: string; note: string };
  computed_at: string;
}

export interface SkillAssertion {
  id: string;
  skill_name: string | null;
  claimed_proficiency: number;
  proficiency_tier: string | null;
  review_state: string;
  evidence_ids: string[];
  created_at: string;
}

export interface EvidenceItem {
  id: string;
  source_type: string;
  source_id: string | null;
  quote: string | null;
  captured_at: string;
  review_state: string;
  metadata: Record<string, unknown>;
}

export interface FitLineage {
  assertions: SkillAssertion[];
  evidence: EvidenceItem[];
}

export interface SkillMatchResult {
  cached: boolean;
  scope: "org" | "candidates" | "team" | "self";
  person: { id: string; name: string; role: string };
  fit: FitRecord;
  lineage?: FitLineage;
  evidence_artifacts?: { artifact_keys: string[]; count: number };
}

export interface GraphNode {
  id: string;
  skill: string;
  category: string;
  outgoing_edges: { target_skill: string; type: string; weight: number }[];
}

export async function computeSkillFit(params: {
  twin_id: string;
  target_id: string;
  scenario?: "current" | "future";
  force?: boolean;
}): Promise<SkillMatchResult> {
  const { data, error } = await supabase.functions.invoke<SkillMatchResult>("skill-match", {
    body: params,
  });
  if (error) throw new Error(error.message || "skill-match failed");
  if (!data?.fit) throw new Error("skill-match: unexpected response");
  return data;
}

export function fitBand(score: number): "high" | "mid" | "low" {
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "mid";
  return "low";
}

export { coverageBreakdown, futureRequirementDiff, resolvedFutureRequirements, developmentForecast } from "./skill-graph-metrics";
