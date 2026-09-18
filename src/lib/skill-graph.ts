import { supabase } from "@/integrations/supabase/client";

// Frontend mirror of the engine's FitRecord shape (persisted in
// digital_twins.computed_fits[] and returned by the skill-match function).
export type FitClassification = "direct" | "adjacent" | "transferable" | "gap";

export interface FitItem {
  skill: string;
  classification: FitClassification;
  required_proficiency: number;
  candidate_proficiency: number | null;
  edge: { from_skill: string; type: string; weight: number } | null;
  contribution: number | null;
  reason: string;
  limitation?: string | null;
}

export interface FitRecord {
  target_type: string;
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
  versions?: { engine: string; evidence: string; requisition: string };
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
