import { describe, expect, it } from "vitest";
import {
  authorizeSkillMatch,
  claimHash,
  computeFit,
  DEFAULT_EVIDENCE_THRESHOLD,
  ENGINE_VERSION,
  findEdge,
  fitIsStale,
  fitKey,
  graphContentHash,
  MATCH_WEIGHTS,
  personContextHash,
  requisitionContentHash,
  type GraphSkill,
  type RequiredSkill,
  type SkillClaim,
} from "./skill-graph-engine.ts";

const claim = (name: string, proficiency: number, rigor: SkillClaim["verification_rigor"] = "low"): SkillClaim => ({
  name,
  proficiency,
  evidence_source: "test",
  verification_rigor: rigor,
});

const req = (skill: string, target_proficiency: number): RequiredSkill => ({ skill, target_proficiency });

const graph: GraphSkill[] = [
  { skill: "JavaScript", category: "Frontend", outgoing_edges: [{ target_skill: "React", type: "ADJACENT_TO", weight: 0.8 }] },
  { skill: "React", category: "Frontend", outgoing_edges: [{ target_skill: "TypeScript", type: "ADJACENT_TO", weight: 0.6 }] },
  { skill: "Go", category: "Backend", outgoing_edges: [{ target_skill: "REST APIs", type: "ADJACENT_TO", weight: 0.6 }] },
  { skill: "REST APIs", category: "Backend", outgoing_edges: [] },
  { skill: "PostgreSQL", category: "Data", outgoing_edges: [] },
  { skill: "Docker", category: "DevOps", outgoing_edges: [{ target_skill: "Containerization", type: "ADJACENT_TO", weight: 0.8 }] },
  { skill: "Containerization", category: "DevOps", outgoing_edges: [] },
  { skill: "Python", category: "Data", outgoing_edges: [{ target_skill: "TypeScript", type: "TRANSFERABLE_TO", weight: 0.5 }] },
];

const TARGET = { type: "requisition" as const, id: "req-1", title: "Test Role" };

describe("S_direct", () => {
  it("averages min(1, candidate/required) across all required skills", () => {
    const fit = computeFit({
      candidateSkills: [claim("Go", 2), claim("PostgreSQL", 3)],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4), req("PostgreSQL", 3), req("Docker", 3), req("REST APIs", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    // Go 0.5, PostgreSQL 1.0, Docker 0, REST APIs 0 -> 0.375
    expect(fit.sections.direct.value).toBeCloseTo(0.375, 3);
    // Candidate with zero direct skills scores 0.
    const none = computeFit({
      candidateSkills: [claim("Python", 5)],
      candidateLevel: 3,
      requiredSkills: [req("Go", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(none.sections.direct.value).toBe(0);
  });

  it("caps direct ratio at 1 even when overqualified", () => {
    const fit = computeFit({
      candidateSkills: [claim("Go", 5)],
      candidateLevel: 3,
      requiredSkills: [req("Go", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(fit.sections.direct.value).toBe(1);
  });
});

describe("S_adjacent", () => {
  it("uses the strongest ADJACENT_TO edge with (proficiency/5)*weight", () => {
    const fit = computeFit({
      candidateSkills: [claim("JavaScript", 5), claim("Go", 5)],
      candidateLevel: 3,
      requiredSkills: [req("React", 3), req("REST APIs", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    // React via JavaScript: (5/5)*0.8 = 0.8 ; REST APIs via Go: (5/5)*0.6 = 0.6
    expect(fit.sections.adjacent.value).toBeCloseTo(0.7, 3);
    expect(fit.classification.adjacent[0].edge?.from_skill).toBe("JavaScript");
  });

  it("is 1.0 when nothing is missing (nothing to be adjacent to)", () => {
    const fit = computeFit({
      candidateSkills: [claim("Go", 5)],
      candidateLevel: 3,
      requiredSkills: [req("Go", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(fit.sections.adjacent.value).toBe(1);
  });
});

describe("S_evidence", () => {
  it("counts only medium/high rigor artifacts and caps at threshold", () => {
    const skills = [
      claim("Go", 3, "high"),
      claim("Docker", 3, "medium"),
      claim("SQL", 3, "low"),
    ];
    const fit = computeFit({
      candidateSkills: skills,
      candidateLevel: 3,
      requiredSkills: [req("Go", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(fit.sections.evidence.artifact_count).toBe(2);
    expect(fit.sections.evidence.value).toBeCloseTo(2 / DEFAULT_EVIDENCE_THRESHOLD, 3);

    const many = computeFit({
      candidateSkills: [claim("a", 3, "high"), claim("b", 3, "high"), claim("c", 3, "high"), claim("d", 3, "high"), claim("e", 3, "high"), claim("f", 3, "medium")],
      candidateLevel: 3,
      requiredSkills: [req("a", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(many.sections.evidence.value).toBe(1);
  });
});

describe("S_seniority", () => {
  it("penalizes 0.2 per level of difference and floors at 0", () => {
    const same = computeFit({
      candidateSkills: [],
      candidateLevel: 4,
      requiredSkills: [req("Go", 3)],
      roleLevel: 4,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(same.sections.seniority.value).toBe(1);

    const diff = computeFit({
      candidateSkills: [],
      candidateLevel: 1,
      requiredSkills: [req("Go", 3)],
      roleLevel: 6,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(diff.sections.seniority.value).toBe(0);
  });
});

describe("full match formula", () => {
  it("computes the validated weighted score exactly", () => {
    const fit = computeFit({
      candidateSkills: [claim("Go", 4, "high"), claim("PostgreSQL", 3, "medium")],
      candidateLevel: 4,
      requiredSkills: [req("Go", 4), req("PostgreSQL", 3), req("Docker", 3), req("REST APIs", 3)],
      roleLevel: 4,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    // direct 0.5 ; adjacent 0.24 ; evidence 0.4 ; seniority 1
    const expected =
      MATCH_WEIGHTS.direct * 0.5 + MATCH_WEIGHTS.adjacent * 0.24 + MATCH_WEIGHTS.evidence * 0.4 + MATCH_WEIGHTS.seniority * 1;
    expect(fit.score).toBeCloseTo(expected, 3);
    expect(fit.score).toBeCloseTo(0.47, 3);
  });
});

describe("classification & explainability", () => {
  it("classifies direct / adjacent / transferable (edge) / transferable (category) / gap", () => {
    const fit = computeFit({
      candidateSkills: [claim("Go", 4), claim("JavaScript", 5), claim("Python", 4)],
      candidateLevel: 3,
      requiredSkills: [
        req("Go", 3), // direct
        req("React", 3), // adjacent via JavaScript
        req("TypeScript", 2), // transferable via Python TRANSFERABLE_TO edge
        req("PostgreSQL", 3), // transferable via same category (Python = Data)
        req("Figma", 2), // gap (no node, no edge, no category)
      ],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(fit.classification.direct.map((i) => i.skill)).toEqual(["Go"]);
    expect(fit.classification.adjacent.map((i) => i.skill)).toEqual(["React"]);
    expect(fit.classification.transferable.map((i) => i.skill)).toEqual(["TypeScript", "PostgreSQL"]);
    expect(fit.classification.gaps.map((i) => i.skill)).toEqual(["Figma"]);
    // Adjacent item must expose its specific edge.
    expect(fit.classification.adjacent[0].edge).toMatchObject({ from_skill: "JavaScript", type: "ADJACENT_TO" });
    // Transferable-via-category carries no edge, only the category note.
    const pg = fit.classification.transferable.find((i) => i.skill === "PostgreSQL");
    expect(pg?.edge).toBeNull();
    expect(pg?.reason).toContain("same category");
  });

  it("never treats a different-named skill as a direct equivalence (no Docker=AWS)", () => {
    const fit = computeFit({
      candidateSkills: [claim("Docker", 5, "high")],
      candidateLevel: 3,
      requiredSkills: [req("AWS", 3)],
      roleLevel: 3,
      skillGraph: graph, // no AWS node, no edge
      target: TARGET,
      scenario: "current",
    });
    expect(fit.classification.direct).toHaveLength(0);
    expect(fit.classification.gaps.map((i) => i.skill)).toEqual(["AWS"]);
    expect(fit.classification.adjacent).toHaveLength(0);
  });

  it("keeps a below-proficiency owned skill as a partial direct, not adjacent", () => {
    const fit = computeFit({
      candidateSkills: [claim("Go", 2)],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
      skillGraph: graph,
      target: TARGET,
      scenario: "current",
    });
    expect(fit.classification.direct).toHaveLength(1);
    expect(fit.classification.direct[0].candidate_proficiency).toBe(2);
    expect(fit.sections.direct.value).toBeCloseTo(0.5, 3);
    expect(fit.classification.adjacent).toHaveLength(0);
    expect(fit.classification.gaps).toHaveLength(0);
  });
});

describe("findEdge & fitKey", () => {
  it("finds typed edges case-insensitively", () => {
    expect(findEdge(graph, "javascript", "REACT", "ADJACENT_TO")?.weight).toBe(0.8);
    expect(findEdge(graph, "Go", "REST APIs", "ADJACENT_TO")?.weight).toBe(0.6);
    expect(findEdge(graph, "Go", "PostgreSQL", "ADJACENT_TO")).toBeNull();
  });

  it("keys fits by type|id|scenario", () => {
    expect(fitKey({ target_type: "requisition", target_id: "r1", scenario: "future" })).toBe("requisition|r1|future");
    expect(fitKey({ target_type: "requisition", target_id: "r1", scenario: "current" })).not.toBe(
      fitKey({ target_type: "requisition", target_id: "r1", scenario: "future" })
    );
  });
});

describe("skill-graph-engine (Phase 8 — evidence-based development)", () => {
  const mkFit = (over: Partial<ReturnType<typeof computeFit>> = {}) => {
    const base = computeFit({
      candidateSkills: [claim("JavaScript", 4, "medium")],
      candidateLevel: 3,
      requiredSkills: [req("React", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: { type: "requisition", id: "r1", title: "FE" },
      scenario: "current",
      evidenceArtifactCount: 2,
      requisitionVersion: "abc",
    });
    return { ...base, ...over };
  };

  it("adjacent support is labeled as not-equivalent and carries its path + weight", () => {
    const fit = mkFit();
    const adj = fit.classification.adjacent[0];
    expect(adj).toBeDefined();
    expect(adj.limitation).toContain("NOT direct equivalence");
    expect(adj.edge).toMatchObject({ from_skill: "JavaScript", type: "ADJACENT_TO", weight: 0.8 });
    expect(adj.contribution).not.toBeNull();
  });

  it("transferable support earns no points and is labeled as the weakest signal", () => {
    const fit = computeFit({
      candidateSkills: [claim("Python", 4, "medium")],
      candidateLevel: 3,
      requiredSkills: [req("TypeScript", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: { type: "requisition", id: "r1", title: "TS" },
      scenario: "current",
      evidenceArtifactCount: 1,
      requisitionVersion: "abc",
    });
    const tr = fit.classification.transferable[0];
    expect(tr).toBeDefined();
    expect(tr.contribution).toBeNull();
    expect(tr.limitation).toContain("weakest signal");
  });

  it("evidence section counts distinct artifacts, not assertions (dedup)", () => {
    const a = mkFit({}); // evidenceArtifactCount = 2
    expect(a.sections.evidence.artifact_count).toBe(2);
    const b = computeFit({
      candidateSkills: [claim("JavaScript", 4, "medium")],
      candidateLevel: 3,
      requiredSkills: [req("React", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: { type: "requisition", id: "r1", title: "FE" },
      scenario: "current",
      evidenceArtifactCount: 1,
      requisitionVersion: "abc",
    });
    expect(b.sections.evidence.artifact_count).toBe(1);
    // Default fallback counts claims (legacy behavior preserved).
    const legacy = computeFit({
      candidateSkills: [claim("JavaScript", 4, "medium")],
      candidateLevel: 3,
      requiredSkills: [req("React", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: { type: "requisition", id: "r1", title: "FE" },
      scenario: "current",
      requisitionVersion: "abc",
    });
    expect(legacy.sections.evidence.artifact_count).toBe(1); // one medium claim
  });

  it("versions record engine, evidence, requisition, graph and context hashes", () => {
    const fit = mkFit();
    expect(fit.versions?.engine).toBe(ENGINE_VERSION);
    expect(fit.versions?.evidence.length).toBeGreaterThan(0);
    expect(fit.versions?.requisition).toBe("abc");
    expect(fit.versions?.graph?.length).toBeGreaterThan(0);
    expect(fit.versions?.context?.length).toBeGreaterThan(0);
    expect(fit.assumptions?.horizon).toBe("Current");
    const future = computeFit({
      candidateSkills: [claim("JavaScript", 4, "medium")],
      candidateLevel: 3,
      requiredSkills: [req("React", 3)],
      roleLevel: 3,
      skillGraph: graph,
      target: { type: "requisition", id: "r1", title: "FE" },
      scenario: "future",
      evidenceArtifactCount: 1,
      requisitionVersion: "abc",
    });
    expect(future.assumptions?.horizon).toBe("12–24 month outlook");
  });

  it("fitIsStale detects engine/evidence/requisition/graph/context changes and legacy fits", () => {
    const fit = mkFit();
    const current = {
      engine: fit.versions!.engine,
      evidence: fit.versions!.evidence,
      requisition: fit.versions!.requisition,
      graph: fit.versions!.graph,
      context: fit.versions!.context,
    };
    expect(fitIsStale(fit, current)).toBe(false);
    expect(fitIsStale(fit, { ...current, engine: "99" })).toBe(true);
    expect(fitIsStale(fit, { ...current, evidence: "changed" })).toBe(true);
    expect(fitIsStale(fit, { ...current, requisition: "changed" })).toBe(true);
    expect(fitIsStale(fit, { ...current, graph: "changed" })).toBe(true);
    expect(fitIsStale(fit, { ...current, context: "changed" })).toBe(true);
    // A fit computed before graph/context fingerprints is stale once.
    const legacy = { ...fit, versions: { ...fit.versions!, graph: undefined, context: undefined } };
    expect(fitIsStale(legacy, current)).toBe(true);
    expect(fitIsStale({ ...fit, versions: undefined }, current)).toBe(true); // legacy fit is stale
    expect(fitIsStale(null, current)).toBe(true);
  });

  it("graph + context hashes are deterministic and content-sensitive", () => {
    const g2: GraphSkill[] = [
      { skill: "JavaScript", category: "Frontend", outgoing_edges: [{ target_skill: "React", type: "ADJACENT_TO", weight: 0.8 }] },
      { skill: "React", category: "Frontend", outgoing_edges: [{ target_skill: "TypeScript", type: "ADJACENT_TO", weight: 0.6 }] },
    ];
    expect(graphContentHash(g2)).toBe(graphContentHash(g2));
    expect(graphContentHash(graph)).not.toBe(graphContentHash(g2)); // missing an edge changes it
    expect(personContextHash(3, 2, 5)).toBe(personContextHash(3, 2, 5));
    expect(personContextHash(3, 2, 5)).not.toBe(personContextHash(4, 2, 5)); // seniority change
    expect(personContextHash(3, 2, 5)).not.toBe(personContextHash(3, 3, 5)); // artifact count change
  });

  it("hashes are deterministic and content-sensitive", () => {
    expect(claimHash([claim("Go", 4, "high")])).toBe(claimHash([claim("Go", 4, "high")]));
    expect(claimHash([claim("Go", 4, "high")])).not.toBe(claimHash([claim("Go", 3, "high")]));
    expect(requisitionContentHash([req("Go", 4)], [], 3)).toBe(requisitionContentHash([req("Go", 4)], [], 3));
    expect(requisitionContentHash([req("Go", 4)], [], 3)).not.toBe(requisitionContentHash([req("Go", 5)], [], 3));
  });
});

describe("authorizeSkillMatch (Batch 1.3)", () => {
  const org = "org-1";
  const other = "org-2";
  const me = "twin-me";
  const teammate = "twin-team";
  const stranger = "twin-stranger";

  const args = (over: Partial<Parameters<typeof authorizeSkillMatch>[0]>) =>
    ({
      callerRole: "employee",
      callerOrgId: org,
      callerTwinId: me,
      targetOrgId: org,
      targetTwinId: stranger,
      targetRole: "employee",
      targetIsInCallerTeam: false,
      ...over,
    });

  it("hr_partner: same-org workforce allowed, candidates and cross-org denied", () => {
    expect(authorizeSkillMatch(args({ callerRole: "hr_partner", targetRole: "employee" }))).toBe("org");
    expect(authorizeSkillMatch(args({ callerRole: "hr_partner", targetRole: "manager" }))).toBe("org");
    expect(authorizeSkillMatch(args({ callerRole: "hr_partner", targetRole: "candidate" }))).toBe("denied");
    expect(authorizeSkillMatch(args({ callerRole: "hr_partner", targetOrgId: other }))).toBe("denied");
  });

  it("hr_executive: same-org scope regardless of target role", () => {
    expect(authorizeSkillMatch(args({ callerRole: "hr_executive", targetRole: "candidate" }))).toBe("org");
    expect(authorizeSkillMatch(args({ callerRole: "hr_executive", targetOrgId: other }))).toBe("denied");
  });

  it("employee: only self, same org", () => {
    expect(authorizeSkillMatch(args({ callerRole: "employee", targetTwinId: me }))).toBe("self");
    expect(authorizeSkillMatch(args({ callerRole: "employee", targetTwinId: teammate, targetIsInCallerTeam: true }))).toBe("denied");
    expect(authorizeSkillMatch(args({ callerRole: "employee", targetTwinId: me, targetOrgId: other }))).toBe("denied");
  });

  it("manager: self or permitted team member, never outside the team", () => {
    expect(authorizeSkillMatch(args({ callerRole: "manager", targetTwinId: me }))).toBe("self");
    expect(authorizeSkillMatch(args({ callerRole: "manager", targetTwinId: teammate, targetIsInCallerTeam: true }))).toBe("team");
    expect(authorizeSkillMatch(args({ callerRole: "manager", targetTwinId: stranger, targetIsInCallerTeam: false }))).toBe("denied");
    // Cross-org team membership is not honored.
    expect(authorizeSkillMatch(args({ callerRole: "manager", targetTwinId: teammate, targetOrgId: other, targetIsInCallerTeam: true }))).toBe("denied");
  });

  it("recruiter: candidates only, employees and cross-org denied", () => {
    expect(authorizeSkillMatch(args({ callerRole: "recruiter", targetRole: "candidate" }))).toBe("candidates");
    expect(authorizeSkillMatch(args({ callerRole: "recruiter", targetRole: "employee" }))).toBe("denied");
    expect(authorizeSkillMatch(args({ callerRole: "recruiter", targetRole: "candidate", targetOrgId: other }))).toBe("denied");
  });

  it("it_security and candidate callers are denied", () => {
    expect(authorizeSkillMatch(args({ callerRole: "it_security", targetRole: "employee" }))).toBe("denied");
    expect(authorizeSkillMatch(args({ callerRole: "it_security", targetTwinId: me }))).toBe("denied");
    expect(authorizeSkillMatch(args({ callerRole: "candidate", targetTwinId: me, targetRole: "candidate" }))).toBe("denied");
  });
});
