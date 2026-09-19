import { describe, expect, it } from "vitest";
import {
  authorizeSkillMatch,
  claimHash,
  computeFit,
  EVIDENCE_FACTOR,
  ENGINE_VERSION,
  evidenceDetailHash,
  findEdge,
  fitIsStale,
  fitKey,
  graphContentHash,
  personContextHash,
  requisitionContentHash,
  resolveFutureRequirements,
  type GraphSkill,
  type RequiredSkill,
  type SkillClaim,
} from "./skill-graph-engine.ts";

const claim = (name: string, proficiency: number, rigor: SkillClaim["verification_rigor"] = "low"): SkillClaim => ({
  name,
  proficiency,
  evidence_source: rigor === "high" ? "evidence_review" : rigor === "medium" ? "assessment" : "self_report",
  verification_rigor: rigor,
});

const req = (skill: string, target_proficiency: number, mandatory = true): RequiredSkill => ({ skill, target_proficiency, mandatory });

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

const base = (over: Parameters<typeof computeFit>[0]) => computeFit({ target: TARGET, roleLevel: 3, skillGraph: graph, ...over });

describe("Phase 9 — requirement-centered verified readiness", () => {
  it("THE FLOOR IS GONE: unrelated evidence + matched seniority score 0", () => {
    // Person holds many verified skills, but NONE map to the role's requirements;
    // seniority matches exactly. Old engine credited evidence+seniority (~25%).
    const fit = base({
      candidateSkills: [claim("Python", 5, "high"), claim("Tableau", 5, "high"), claim("ML Ops", 5, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4), req("Docker", 3), req("PostgreSQL", 3)],
      roleLevel: 3,
      evidenceArtifactCount: 12,
    });
    expect(fit.score).toBe(0);
    expect(fit.profile_match).toBe(0);
    // Evidence base is reported, never scored.
    expect(fit.scoring.evidence_artifacts.count).toBe(12);
    expect(fit.contextual_alignment.candidate_level).toBe(3);
  });

  it("verified readiness counts only accepted evidence; claims are provisional-only", () => {
    const accepted = base({
      candidateSkills: [claim("Go", 4, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
    });
    expect(accepted.score).toBe(1);
    expect(accepted.profile_match).toBe(1);

    const selfReported = base({
      candidateSkills: [claim("Go", 4, "low")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
    });
    expect(selfReported.score).toBe(0); // no accepted evidence -> no verified readiness
    expect(selfReported.profile_match).toBeCloseTo(EVIDENCE_FACTOR.claimed, 3); // attenuated
    expect(selfReported.mandatory_gate.met).toBe(false);
  });

  it("raises target can never increase readiness", () => {
    const low = base({
      candidateSkills: [claim("Go", 3, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 3)],
      roleLevel: 3,
    });
    const high = base({
      candidateSkills: [claim("Go", 3, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 5)],
      roleLevel: 3,
    });
    expect(high.score).toBeLessThan(low.score);
    expect(high.score).toBeCloseTo(3 / 5, 3);
  });

  it("accepting relevant evidence cannot decrease verified readiness", () => {
    const before = base({
      candidateSkills: [claim("Go", 3, "low")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 3)],
      roleLevel: 3,
    });
    const after = base({
      candidateSkills: [claim("Go", 3, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 3)],
      roleLevel: 3,
    });
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("rejecting / expiring evidence cannot increase readiness", () => {
    const before = base({
      candidateSkills: [claim("Go", 4, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
    });
    const disputed = base({
      candidateSkills: [{ ...claim("Go", 4, "low"), evidence_source: "evidence_record" }],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
    });
    expect(disputed.score).toBeLessThan(before.score);
    expect(disputed.score).toBe(0);
  });

  it("reordering requirements does not change the score", () => {
    const a = base({
      candidateSkills: [claim("Go", 4, "high"), claim("PostgreSQL", 3, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4), req("PostgreSQL", 3), req("Docker", 3)],
      roleLevel: 3,
    });
    const b = base({
      candidateSkills: [claim("Go", 4, "high"), claim("PostgreSQL", 3, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Docker", 3), req("Go", 4), req("PostgreSQL", 3)],
      roleLevel: 3,
    });
    expect(b.score).toBe(a.score);
  });

  it("same-artifact duplicates never inflate (per-skill dedup)", () => {
    const one = base({
      candidateSkills: [claim("Go", 4, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
      evidenceArtifactCount: 1,
    });
    // Duplicate claims for the SAME skill at a higher rigor can't double-count.
    const dup = base({
      candidateSkills: [claim("Go", 4, "high"), claim("GO", 5, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
      evidenceArtifactCount: 1,
    });
    expect(dup.score).toBe(1);
    expect(dup.scoring.requirements.filter((i) => i.skill.toLowerCase() === "go").length).toBe(1);
    expect(dup.score).toBe(one.score);
  });

  it("transferable support is NEVER direct: no points, labeled weakest signal", () => {
    const fit = base({
      candidateSkills: [claim("Python", 4, "high")],
      candidateLevel: 3,
      requiredSkills: [req("TypeScript", 3)],
      roleLevel: 3,
    });
    expect(fit.score).toBe(0);
    expect(fit.profile_match).toBe(0);
    const tr = fit.scoring.requirements[0];
    expect(tr.classification).toBe("transferable_foundation");
    expect(tr.contribution).toBe(0);
    expect(tr.limitation).toContain("weakest signal");
  });

  it("adjacent support counts only when the supporting claim is accepted", () => {
    const accepted = base({
      candidateSkills: [claim("JavaScript", 5, "high")],
      candidateLevel: 3,
      requiredSkills: [req("React", 3)],
      roleLevel: 3,
    });
    expect(accepted.scoring.requirements[0].classification).toBe("adjacent_support");
    expect(accepted.score).toBeCloseTo(0.8, 3); // (5/5)*0.8 accepted

    const selfReported = base({
      candidateSkills: [claim("JavaScript", 5, "low")],
      candidateLevel: 3,
      requiredSkills: [req("React", 3)],
      roleLevel: 3,
    });
    expect(selfReported.score).toBe(0); // not accepted -> no verified readiness
    expect(selfReported.profile_match).toBeCloseTo(0.8 * EVIDENCE_FACTOR.claimed, 3);
  });

  it("mandatory gate: every mandatory requirement needs accepted evidence", () => {
    const fit = base({
      candidateSkills: [claim("Go", 4, "high"), claim("Docker", 4, "low")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4, true), req("Docker", 3, true), req("PostgreSQL", 3, true)],
      roleLevel: 3,
    });
    expect(fit.mandatory_gate.met).toBe(false);
    expect(fit.mandatory_gate.unmet_skills).toContain("PostgreSQL");
    // Docker is provisional-only -> still unmet for verified readiness.
    expect(fit.mandatory_gate.unmet_skills).toContain("Docker");
    expect(fit.scoring.mandatory.gated).toBe(true);
    // The unmet mandatory does not block the met one from scoring.
    expect(fit.score).toBeGreaterThan(0);
  });

  it("mandatory vs preferred are normalized in separate sections with visible weights", () => {
    const fit = base({
      candidateSkills: [claim("Go", 4, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4, true), req("Kubernetes", 3, false), req("REST APIs", 3, false)],
      roleLevel: 3,
    });
    expect(fit.scoring.mandatory.readiness).toBe(1);
    // preferred: Kubernetes 0, REST APIs via Go (4/5*0.6=0.48 accepted) -> 0.24
    expect(fit.scoring.preferred?.readiness).toBeCloseTo(0.24, 3);
    // Overall = 0.7*1 + 0.3*0.24
    expect(fit.score).toBeCloseTo(0.7 * 1 + 0.3 * 0.24, 3);
    expect(fit.scoring.group_weights).toEqual({ mandatory: 0.7, preferred: 0.3 });
  });

  it("transferable-only / missing requirements are gaps, not hidden 'no gaps'", () => {
    const fit = base({
      candidateSkills: [claim("Python", 4, "high")],
      candidateLevel: 3,
      requiredSkills: [req("TypeScript", 3), req("Figma", 2)],
      roleLevel: 3,
    });
    const unmet = fit.scoring.requirements.filter((r) => r.effective_proficiency < r.required_proficiency);
    expect(unmet.map((r) => r.skill)).toEqual(["TypeScript", "Figma"]);
    expect(fit.classification.transferable_foundation.map((i) => i.skill)).toEqual(["TypeScript"]);
    expect(fit.classification.missing.map((i) => i.skill)).toEqual(["Figma"]);
  });
});

describe("resolveFutureRequirements (Phase 9)", () => {
  it("resolves additions + raised targets; keeps current unless explicitly obsolete", () => {
    const { resolved, added, raised, kept, obsolete } = resolveFutureRequirements(
      [req("Go", 4), req("Docker", 3), req("PostgreSQL", 3)],
      [req("Go", 5), req("Docker", 3), req("Kubernetes", 2)],
      [req("PostgreSQL", 3, true)]
    );
    expect(added).toEqual(["Kubernetes"]);
    expect(raised).toEqual(["Go"]);
    expect(obsolete).toEqual(["postgresql"]);
    expect(kept).toEqual(["Docker"]);
    const bySkill = new Map(resolved.map((r) => [r.skill, r]));
    expect(bySkill.get("Go")?.target_proficiency).toBe(5);
    expect(bySkill.get("Docker")).toBeDefined();
    expect(bySkill.has("PostgreSQL")).toBe(false);
    // future additions are future capability signals -> preferred
    expect(bySkill.get("Kubernetes")?.mandatory).toBe(false);
    // kept current skills preserve their mandatory flag
    expect(bySkill.get("Docker")?.mandatory).toBe(true);
  });

  it("dedups case-insensitively", () => {
    const { resolved, added } = resolveFutureRequirements(
      [{ skill: "sql", target_proficiency: 3 }],
      [{ skill: "SQL", target_proficiency: 4 }]
    );
    expect(resolved.length).toBe(1);
    expect(resolved[0].target_proficiency).toBe(4);
    expect(added).toEqual([]);
  });

  it("a current skill absent from the future list is KEPT (removal only when explicitly obsolete)", () => {
    const { resolved } = resolveFutureRequirements(
      [req("Go", 4), req("Docker", 3)],
      [req("Go", 4)]
    );
    expect(resolved.map((r) => r.skill)).toContain("Docker");
  });

  it("missing future definition is not a score", () => {
    const { resolved } = resolveFutureRequirements([req("Go", 4)], []);
    expect(resolved.length).toBe(1); // current still applies
  });
});

describe("fingerprint & stale detection (Phase 9)", () => {
  const fit = base({
    candidateSkills: [claim("Go", 4, "high")],
    candidateLevel: 3,
    requiredSkills: [req("Go", 4), req("PostgreSQL", 3, true), req("Docker", 3, false)],
    roleLevel: 3,
    evidenceArtifactCount: 2,
    evidenceVersion: "ev1",
    requisitionVersion: "rq1",
  });

  it("versions record engine, evidence, requisition, graph, context and plan", () => {
    expect(fit.versions?.engine).toBe(ENGINE_VERSION);
    expect(fit.versions?.evidence).toBe("ev1");
    expect(fit.versions?.requisition).toBe("rq1");
    expect(fit.versions?.graph?.length).toBeGreaterThan(0);
    expect(fit.versions?.context?.length).toBeGreaterThan(0);
    expect(fit.versions?.plan).toBe("none");
  });

  it("requisition fingerprint covers mandatory/preferred, target, weight and resolved future", () => {
    const h1 = requisitionContentHash({
      current: [req("Go", 4, true)],
      future: [req("Go", 4, true)],
      resolvedFuture: [req("Go", 4, true)],
      seniorityLevel: 4,
    });
    const h2 = requisitionContentHash({
      current: [req("Go", 4, false)],
      future: [req("Go", 4, false)],
      resolvedFuture: [req("Go", 4, false)],
      seniorityLevel: 4,
    });
    const h3 = requisitionContentHash({
      current: [req("Go", 4, true)],
      future: [req("Go", 4, true)],
      resolvedFuture: [req("Go", 5, true)],
      seniorityLevel: 4,
    });
    expect(h1).toBe(h1);
    expect(h2).not.toBe(h1); // mandatory flip changes fingerprint
    expect(h3).not.toBe(h1); // raised resolved target changes fingerprint
  });

  it("evidence fingerprint covers assertion ids, states, proficiency, artifacts, timestamps", () => {
    const l1 = {
      assertions: [{ id: "a1", skill_id: "s1", claimed_proficiency: 4, review_state: "reviewer_confirmed", evidence_ids: ["e1"] }],
      evidence: [{ id: "e1", source_type: "resume", source_id: "r1", captured_at: "2026-08-01", review_state: "reviewer_confirmed" }],
    };
    const l2 = {
      assertions: [{ id: "a1", skill_id: "s1", claimed_proficiency: 3, review_state: "reviewer_confirmed", evidence_ids: ["e1"] }],
      evidence: [{ id: "e1", source_type: "resume", source_id: "r1", captured_at: "2026-08-01", review_state: "reviewer_confirmed" }],
    };
    const l3 = {
      assertions: [{ id: "a2", skill_id: "s1", claimed_proficiency: 4, review_state: "disputed", evidence_ids: ["e1"] }],
      evidence: [{ id: "e1", source_type: "resume", source_id: "r1", captured_at: "2026-08-01", review_state: "disputed" }],
    };
    expect(evidenceDetailHash(l1)).toBe(evidenceDetailHash(l1));
    expect(evidenceDetailHash(l2)).not.toBe(evidenceDetailHash(l1)); // proficiency change
    expect(evidenceDetailHash(l3)).not.toBe(evidenceDetailHash(l1)); // review-state change
  });

  it("fitIsStale detects engine/evidence/requisition/graph/context/plan changes", () => {
    const current = {
      engine: fit.versions!.engine,
      evidence: fit.versions!.evidence,
      requisition: fit.versions!.requisition,
      graph: fit.versions!.graph,
      context: fit.versions!.context,
      plan: fit.versions!.plan,
    };
    expect(fitIsStale(fit, current)).toBe(false);
    expect(fitIsStale(fit, { ...current, engine: "99" })).toBe(true);
    expect(fitIsStale(fit, { ...current, evidence: "changed" })).toBe(true);
    expect(fitIsStale(fit, { ...current, requisition: "changed" })).toBe(true);
    expect(fitIsStale(fit, { ...current, graph: "changed" })).toBe(true);
    expect(fitIsStale(fit, { ...current, context: "changed" })).toBe(true);
    expect(fitIsStale(fit, { ...current, plan: "plan-2" })).toBe(true);
    expect(fitIsStale({ ...fit, versions: undefined }, current)).toBe(true);
    expect(fitIsStale(null, current)).toBe(true);
  });

  it("graph hash changes when an edge changes (edge-dependent fits invalidate)", () => {
    const g2: GraphSkill[] = [{ ...graph[0], outgoing_edges: [{ target_skill: "React", type: "ADJACENT_TO", weight: 0.9 }] }, ...graph.slice(1)];
    expect(graphContentHash(g2)).not.toBe(graphContentHash(graph));
    expect(personContextHash(3, 2, 5)).not.toBe(personContextHash(4, 2, 5));
  });
});

describe("classification & explainability", () => {
  it("classifies verified / provisional / below-target / adjacent / transferable / missing", () => {
    const fit = base({
      candidateSkills: [claim("Go", 4, "high"), claim("JavaScript", 5, "low"), claim("Python", 4, "high")],
      candidateLevel: 3,
      requiredSkills: [
        req("Go", 3), // verified direct (accepted, at/above)
        req("REST APIs", 3), // adjacent via Go (accepted supporting claim)
        req("React", 3), // adjacent via JavaScript (provisional supporting claim)
        req("TypeScript", 2), // transferable via Python edge
        req("PostgreSQL", 3), // transferable via same category (Python = Data)? Python and PostgreSQL both Data
        req("Figma", 2), // missing
      ],
      roleLevel: 3,
    });
    expect(fit.classification.verified_direct.map((i) => i.skill)).toEqual(["Go"]);
    expect(fit.classification.adjacent_support.map((i) => i.skill)).toEqual(["REST APIs", "React"]);
    expect(fit.classification.transferable_foundation.map((i) => i.skill)).toEqual(["TypeScript", "PostgreSQL"]);
    expect(fit.classification.missing.map((i) => i.skill)).toEqual(["Figma"]);
    // Verified vs provisional is visible on adjacent items too.
    const restApi = fit.scoring.requirements.find((i) => i.skill === "REST APIs");
    expect(restApi?.verified).toBe(true);
    const react = fit.scoring.requirements.find((i) => i.skill === "React");
    expect(react?.verified).toBe(false);
    expect(react?.provisional).toBe(true);
  });

  it("keeps a below-proficiency owned skill as below_target, not a gap", () => {
    const fit = base({
      candidateSkills: [claim("Go", 2, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
    });
    const item = fit.scoring.requirements[0];
    expect(item.classification).toBe("below_target");
    expect(item.effective_proficiency).toBe(2);
    expect(item.gap).toBe(2);
    expect(fit.score).toBeCloseTo(0.5, 3);
  });

  it("never treats a different-named skill as direct equivalence", () => {
    const fit = base({
      candidateSkills: [claim("Docker", 5, "high")],
      candidateLevel: 3,
      requiredSkills: [req("AWS", 3)],
      roleLevel: 3,
    });
    expect(fit.scoring.requirements[0].classification).toBe("missing");
    expect(fit.score).toBe(0);
  });

  it("freshness is derived from the newest supporting assertion", () => {
    const fit = base({
      candidateSkills: [claim("Go", 4, "high")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 4)],
      roleLevel: 3,
      computedAt: "2026-09-10T00:00:00Z",
      evidenceDetail: { go: { captured_at: "2026-09-01T00:00:00Z", artifact_key: "artifact:resume|r1" } },
    });
    expect(fit.scoring.requirements[0].freshness_days).toBe(9);
    expect(fit.scoring.requirements[0].evidence_source).toBe("artifact:resume|r1");
  });

  it("a dev task without an accepted assessment never raises verified readiness", () => {
    // Only accepted evidence counts — a claimed proficiency after 'training'
    // is still provisional until an assessment/review accepts it.
    const fit = base({
      candidateSkills: [claim("Go", 5, "low")],
      candidateLevel: 3,
      requiredSkills: [req("Go", 3)],
      roleLevel: 3,
    });
    expect(fit.score).toBe(0);
    expect(fit.profile_match).toBeGreaterThan(0);
    expect(fit.mandatory_gate.met).toBe(false);
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
