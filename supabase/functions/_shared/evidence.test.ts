import { describe, expect, it } from "vitest";
import {
  buildSkillClaims,
  evidenceSourceForState,
  resolveSkillClaims,
  type AssertionRow,
  type EvidenceRow,
} from "./evidence.ts";

const a = (over: Partial<AssertionRow> & { skill_name: string }): AssertionRow => ({
  id: over.id ?? "a1",
  org_id: "org",
  twin_id: "twin",
  skill_id: "s1",
  claimed_proficiency: over.claimed_proficiency ?? 3,
  proficiency_tier: over.proficiency_tier ?? null,
  review_state: over.review_state ?? "claimed",
  evidence_ids: over.evidence_ids ?? [],
  created_at: "2026-01-01T00:00:00Z",
  skill_name: over.skill_name,
});

describe("buildSkillClaims", () => {
  it("maps review states to the intended verification rigor", () => {
    const claims = buildSkillClaims([
      a({ skill_name: "Go", review_state: "reviewer_confirmed", claimed_proficiency: 4 }),
      a({ skill_name: "SQL", review_state: "assessment_supported", claimed_proficiency: 3 }),
      a({ skill_name: "Docker", review_state: "extracted", claimed_proficiency: 2 }),
      a({ skill_name: "Python", review_state: "claimed", claimed_proficiency: 3 }),
    ]);
    expect(claims).toHaveLength(4);
    const byName = Object.fromEntries(claims.map((c) => [c.name, c]));
    expect(byName.Go.verification_rigor).toBe("high");
    expect(byName.Go.evidence_source).toBe("evidence_review");
    expect(byName.SQL.verification_rigor).toBe("medium");
    expect(byName.SQL.evidence_source).toBe("assessment");
    expect(byName.Docker.verification_rigor).toBe("low");
    expect(byName.Docker.evidence_source).toBe("resume_extraction");
    expect(byName.Python.verification_rigor).toBe("low");
    expect(byName.Python.evidence_source).toBe("self_report");
  });

  it("keeps one assertion per skill — the strongest review state wins", () => {
    const claims = buildSkillClaims([
      a({ skill_name: "Go", review_state: "extracted", claimed_proficiency: 2 }),
      a({ skill_name: "Go", review_state: "reviewer_confirmed", claimed_proficiency: 4 }),
      a({ skill_name: "Go", review_state: "claimed", claimed_proficiency: 5 }),
    ]);
    expect(claims).toHaveLength(1);
    expect(claims[0].verification_rigor).toBe("high");
    expect(claims[0].proficiency).toBe(4);
  });

  it("ties break by higher proficiency within the same state", () => {
    const claims = buildSkillClaims([
      a({ skill_name: "React", review_state: "claimed", claimed_proficiency: 2 }),
      a({ skill_name: "React", review_state: "claimed", claimed_proficiency: 3 }),
    ]);
    expect(claims).toHaveLength(1);
    expect(claims[0].proficiency).toBe(3);
  });

  it("excludes invalidated states (expired/disputed/superseded) from scoring", () => {
    const claims = buildSkillClaims([
      a({ skill_name: "Legacy", review_state: "superseded", claimed_proficiency: 5 }),
      a({ skill_name: "Disputed", review_state: "disputed", claimed_proficiency: 4 }),
    ]);
    expect(claims).toHaveLength(0);
  });

  it("drops assertions without a resolvable skill name", () => {
    const claims = buildSkillClaims([a({ skill_name: "" }), a({ skill_name: "   " })]);
    expect(claims).toHaveLength(0);
  });
});

describe("evidenceSourceForState", () => {
  it("maps each state to a stable source label", () => {
    expect(evidenceSourceForState("reviewer_confirmed")).toBe("evidence_review");
    expect(evidenceSourceForState("assessment_supported")).toBe("assessment");
    expect(evidenceSourceForState("extracted")).toBe("resume_extraction");
    expect(evidenceSourceForState("claimed")).toBe("self_report");
  });
});

describe("resolveSkillClaims", () => {
  /** Minimal awaitable supabase-query stub covering the two reads used. */
  function stub(rows: { assertions: AssertionRow[]; skills: { id: string; skill: string }[] }) {
    const handlers: Record<string, () => { data: unknown }> = {
      skill_assertions: () => ({ data: rows.assertions }),
      skill_graph: () => ({ data: rows.skills }),
    };
    const makeChain = (table: string) => {
      const c = {
        select: () => c,
        eq: () => c,
        in: () => c,
        maybeSingle: () => Promise.resolve({ data: null }),
        then: (resolve: (v: { data: unknown }) => void) => resolve((handlers[table] ?? (() => ({ data: [] })))()),
      };
      return c;
    };
    return { from: (table: string) => makeChain(table) };
  }

  it("uses assertions when present, joining canonical skill names", async () => {
    const client = stub({
      assertions: [
        { ...a({ skill_name: "Go", review_state: "reviewer_confirmed" }), skill_id: "sg1" },
        { ...a({ skill_name: "Docker", review_state: "extracted" }), skill_id: "sg2" },
      ],
      skills: [
        { id: "sg1", skill: "Go" },
        { id: "sg2", skill: "Docker" },
      ],
    });
    const claims = await resolveSkillClaims(client, { id: "twin", verified_skills: [{ name: "Fake", proficiency: 5 }] });
    expect(claims.map((c) => c.name).sort()).toEqual(["Docker", "Go"]);
    expect(claims.find((c) => c.name === "Go")!.verification_rigor).toBe("high");
    expect(claims.find((c) => c.name === "Docker")!.verification_rigor).toBe("low");
  });

  it("falls back to legacy verified_skills when no assertions exist", async () => {
    const client = stub({ assertions: [], skills: [] });
    const claims = await resolveSkillClaims(client, {
      id: "twin",
      verified_skills: [{ name: "SQL", proficiency: 4, evidence_source: "certification", verification_rigor: "high" }],
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].name).toBe("SQL");
  });
});

describe("type surface", () => {
  it("exposes the evidence row shape", () => {
    const ev: EvidenceRow = {
      id: "e1",
      org_id: "org",
      twin_id: "twin",
      source_type: "resume_document",
      source_id: "resume:job1",
      source_version: null,
      captured_at: "2026-01-01T00:00:00Z",
      quote: "Built Go microservices",
      span: null,
      review_state: "extracted",
      reviewed_by: null,
      reviewed_at: null,
      metadata: {},
    };
    expect(ev.source_type).toBe("resume_document");
  });
});
