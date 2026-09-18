// ---------------------------------------------------------------------------
// WorkSense evidence model — normalized source of truth for skills.
// skill_assertions (claimed / extracted / assessment_supported /
// reviewer_confirmed / …) each reference evidence_items (quote, source,
// captured_at). digital_twins.verified_skills stays a denormalized cache of
// *confirmed* skills only (reviewer_confirmed / assessment_supported); legacy
// records without assertions fall back to verified_skills. Resume extractions
// write 'extracted' assertions (rigor "low") — they never inflate the
// confirmed list or the fit evidence score.
// ---------------------------------------------------------------------------

import type { SkillClaim } from "./skill-graph-engine.ts";

export type ReviewState =
  | "claimed"
  | "extracted"
  | "assessment_supported"
  | "reviewer_confirmed"
  | "expired"
  | "disputed"
  | "superseded";

export const REVIEW_STATES: ReviewState[] = [
  "claimed",
  "extracted",
  "assessment_supported",
  "reviewer_confirmed",
  "expired",
  "disputed",
  "superseded",
];

export interface AssertionRow {
  id: string;
  org_id: string;
  twin_id: string;
  skill_id: string;
  claimed_proficiency: number;
  proficiency_tier: string | null;
  review_state: ReviewState;
  evidence_ids: string[];
  created_at: string;
  /** Joined from skill_graph (not a column). */
  skill_name?: string | null;
}

export interface EvidenceRow {
  id: string;
  org_id: string;
  twin_id: string | null;
  source_type: string;
  source_id: string | null;
  source_version: string | null;
  captured_at: string;
  quote: string | null;
  span: string | null;
  review_state: ReviewState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  metadata: Record<string, unknown>;
}

/** States that still represent a live claim (scoring includes them, at a
 *  rigor derived from how they were confirmed). Invalidated records
 *  (expired/disputed/superseded) stay visible for lineage but never score. */
const SCORABLE_STATES = new Set<ReviewState>([
  "claimed",
  "extracted",
  "assessment_supported",
  "reviewer_confirmed",
]);

const RIGOR_BY_STATE: Record<ReviewState, SkillClaim["verification_rigor"]> = {
  reviewer_confirmed: "high",
  assessment_supported: "medium",
  extracted: "low",
  claimed: "low",
  expired: "low",
  disputed: "low",
  superseded: "low",
};

/** Highest-confidence state wins when several assertions target one skill. */
const STATE_RANK: Record<ReviewState, number> = {
  reviewer_confirmed: 5,
  assessment_supported: 4,
  extracted: 3,
  claimed: 2,
  expired: 1,
  disputed: 1,
  superseded: 1,
};

export function evidenceSourceForState(state: ReviewState): string {
  switch (state) {
    case "reviewer_confirmed":
      return "evidence_review";
    case "assessment_supported":
      return "assessment";
    case "extracted":
      return "resume_extraction";
    case "claimed":
      return "self_report";
    default:
      return "evidence_record";
  }
}

/** Map skill_assertions (enriched with skill_name) to engine SkillClaims.
 *  Dedup per skill keeping the strongest review state; invalidated states are
 *  excluded from scoring. */
export function buildSkillClaims(assertions: AssertionRow[]): SkillClaim[] {
  const best = new Map<string, AssertionRow>();
  for (const a of assertions) {
    if (!SCORABLE_STATES.has(a.review_state)) continue;
    const name = (a.skill_name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const cur = best.get(key);
    if (
      !cur ||
      STATE_RANK[a.review_state] > STATE_RANK[cur.review_state] ||
      (STATE_RANK[a.review_state] === STATE_RANK[cur.review_state] &&
        a.claimed_proficiency > cur.claimed_proficiency)
    ) {
      best.set(key, a);
    }
  }
  return [...best.values()].map((a) => ({
    name: (a.skill_name ?? "").trim(),
    proficiency: a.claimed_proficiency,
    evidence_source: evidenceSourceForState(a.review_state),
    verification_rigor: RIGOR_BY_STATE[a.review_state] ?? "low",
  }));
}

/** Load a twin's skill_assertions, joined with canonical skill names. */
export async function loadAssertions(supabase, twinId: string): Promise<AssertionRow[]> {
  const { data, error } = await supabase
    .from("skill_assertions")
    .select(
      "id, org_id, twin_id, skill_id, claimed_proficiency, proficiency_tier, review_state, evidence_ids, created_at"
    )
    .eq("twin_id", twinId);
  if (error) throw error;
  const rows = (data ?? []) as AssertionRow[];
  if (rows.length === 0) return rows;

  const skillIds = [...new Set(rows.map((r) => r.skill_id))];
  const { data: skills, error: skillErr } = await supabase
    .from("skill_graph")
    .select("id, skill")
    .in("id", skillIds);
  if (skillErr) throw skillErr;
  const nameById = new Map<string, string>((skills ?? []).map((s) => [String(s.id), String(s.skill)]));
  return rows.map((r) => ({ ...r, skill_name: nameById.get(r.skill_id) ?? null }));
}

/** Load evidence_items by id, preserving input order. */
export async function loadEvidence(supabase, evidenceIds: string[]): Promise<EvidenceRow[]> {
  const ids = [...new Set(evidenceIds ?? [])];
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("evidence_items").select("*").in("id", ids);
  if (error) throw error;
  const byId = new Map((data ?? []).map((e) => [e.id, e as EvidenceRow]));
  return ids.map((id) => byId.get(id)).filter((e): e is EvidenceRow => Boolean(e));
}

/** Full lineage for a twin: assertions (enriched) + their evidence. */
export async function resolveLineage(
  supabase,
  twinId: string
): Promise<{ assertions: AssertionRow[]; evidence: EvidenceRow[] }> {
  const assertions = await loadAssertions(supabase, twinId);
  const evidenceIds = [...new Set(assertions.flatMap((a) => a.evidence_ids ?? []))];
  const evidence = await loadEvidence(supabase, evidenceIds);
  return { assertions, evidence };
}

/** Claims for scoring: assertions when present (canonical), otherwise the
 *  legacy verified_skills jsonb (golden seed / pre-migration records). */
export async function resolveSkillClaims(
  supabase,
  twin: { id: string; verified_skills?: unknown }
): Promise<SkillClaim[]> {
  const assertions = await loadAssertions(supabase, twin.id);
  if (assertions.length > 0) return buildSkillClaims(assertions);
  return (twin.verified_skills ?? []) as SkillClaim[];
}

/** Resolve a skill name to its skill_graph id for an org, creating the concept
 *  row on first sight (the graph is a growing canonical concept store). */
export async function resolveSkillId(supabase, orgId: string, skillName: string): Promise<string> {
  const name = String(skillName ?? "").trim();
  if (!name) throw new Error("resolveSkillId: empty skill name");
  const { data } = await supabase
    .from("skill_graph")
    .select("id")
    .eq("org_id", orgId)
    .eq("skill", name)
    .maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await supabase
    .from("skill_graph")
    .insert({
      org_id: orgId,
      skill: name,
      category: "Uncategorized",
      outgoing_edges: [],
      aliases: [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}
