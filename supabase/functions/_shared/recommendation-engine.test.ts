import { describe, expect, it } from "vitest";
import { scanForRecommendations, type ScanInputs } from "./recommendation-engine.ts";

const base = (over: Partial<ScanInputs> = {}): ScanInputs => ({
  twins: [
    {
      id: "t1",
      name: "Samira Patel",
      role: "employee",
      status: "active",
      signals: [
        { type: "workforce_review_signal", value: 68 },
        { type: "engagement_survey", value: "3.1 / 5", trend: "declining" },
      ],
      performance_history: [
        { cycle: "2025-H2", rating: "Exceeds Expectations" },
        { cycle: "2026-H1", rating: "Exceeds Expectations" },
      ],
      verified_skills: [
        { name: "SQL", proficiency: 4 },
        { name: "Python", proficiency: 3 },
        { name: "Tableau", proficiency: 3 },
        { name: "Data Modeling", proficiency: 2 },
      ],
      seniority_level: 3,
    },
    {
      id: "t2",
      name: "Alex Chen",
      role: "employee",
      status: "active",
      signals: [{ type: "workforce_review_signal", value: 2 }],
      performance_history: [{ cycle: "2026-H1", rating: "On Track" }],
      verified_skills: [{ name: "Go", proficiency: 3 }],
      seniority_level: 3,
    },
  ],
  requisitions: [
    {
      id: "req-a",
      title: "Data Analyst",
      required_skills: [
        { skill: "SQL", target_proficiency: 4 },
        { skill: "Python", target_proficiency: 3 },
        { skill: "Data Modeling", target_proficiency: 3 },
        { skill: "Tableau", target_proficiency: 2 },
      ],
      future_skills: [],
      seniority_level: 3,
    },
  ],
  graph: [
    { skill: "Python", category: "Data", outgoing_edges: [{ target_skill: "Data Modeling", type: "ADJACENT_TO", weight: 0.7 }] },
    { skill: "SQL", category: "Data", outgoing_edges: [{ target_skill: "Python", type: "ADJACENT_TO", weight: 0.6 }] },
    { skill: "Data Modeling", category: "Data", outgoing_edges: [] },
    { skill: "Tableau", category: "Analytics", outgoing_edges: [] },
  ],
  journeys: [],
  ...over,
});

describe("recommendation trigger engine (deterministic)", () => {
  it("fires RETENTION_INTERVENTION when the signal exceeds 65", () => {
    const recs = scanForRecommendations(base());
    const retention = recs.find((r) => r.category === "RETENTION_INTERVENTION");
    expect(retention).toBeDefined();
    expect(retention?.twin_id).toBe("t1");
    expect(retention?.urgency).toBe("high");
    expect(retention?.evidence_ledger.some((e) => e.source === "WORKFORCE_REVIEW_SIGNAL")).toBe(true);
  });

  it("does not fire for a low-signal employee", () => {
    const recs = scanForRecommendations(base());
    expect(recs.some((r) => r.twin_id === "t2" && r.category === "RETENTION_INTERVENTION")).toBe(false);
  });

  it("fires INTERNAL_MOBILITY only when signal>65, strong performance AND a >=70% soft fit", () => {
    const recs = scanForRecommendations(base());
    const mobility = recs.find((r) => r.category === "INTERNAL_MOBILITY");
    // Samira has 4 direct skills -> direct share 100%, soft share 0 -> no mobility.
    expect(mobility).toBeUndefined();

    // Give Samira a mostly-adjacent profile so the fit becomes soft-weighted:
    // Python covers Data Modeling and ETL via ADJACENT_TO edges, no direct skills.
    const input = base();
    input.twins[0].verified_skills = [{ name: "Python", proficiency: 4 }];
    input.graph = [
      { skill: "Python", category: "Data", outgoing_edges: [{ target_skill: "Data Modeling", type: "ADJACENT_TO", weight: 0.7 }, { target_skill: "ETL", type: "ADJACENT_TO", weight: 0.7 }] },
      { skill: "Data Modeling", category: "Data", outgoing_edges: [] },
      { skill: "ETL", category: "Data", outgoing_edges: [] },
    ];
    input.requisitions[0].required_skills = [
      { skill: "Data Modeling", target_proficiency: 3 },
      { skill: "ETL", target_proficiency: 3 },
    ];
    const recs2 = scanForRecommendations(input);
    expect(recs2.find((r) => r.category === "INTERNAL_MOBILITY")?.twin_id).toBe("t1");
  });

  it("fires ONBOARDING_REPLAN when a journey task is blocked", () => {
    const input = base({
      journeys: [
        { twin_id: "t2", status: "active", tasks: [{ id: "it", title: "IT & Laptop Provisioning", status: "blocked", blocked: { note: "laptop not delivered" } }] },
      ],
    });
    const recs = scanForRecommendations(input);
    const replan = recs.find((r) => r.category === "ONBOARDING_REPLAN");
    expect(replan).toBeDefined();
    expect(replan?.twin_id).toBe("t2");
    expect(replan?.evidence_ledger[0].source).toBe("ONBOARDING_BLOCKER");
  });

  it("fires ONBOARDING_REPLAN from the adaptive-plan mapping with the open blocker note", () => {
    // recommendation-scan maps adaptive onboarding_tasks.state + open blockers
    // into this journey shape; the note must survive into the evidence ledger.
    const input = base({
      journeys: [
        {
          twin_id: "t2",
          status: "approved",
          tasks: [
            { id: "access_sso", title: "System Access & SSO Enrollment", status: "blocked", blocked: { note: "SSO enrollment blocked — laptop WS-8842 pending provisioning" } },
            { id: "team_intro", title: "Team Introduction", status: "blocked", blocked: null },
          ],
        },
      ],
    });
    const recs = scanForRecommendations(input);
    const replan = recs.find((r) => r.category === "ONBOARDING_REPLAN");
    expect(replan).toBeDefined();
    expect(replan?.evidence_ledger[0].fact).toContain("laptop WS-8842 pending provisioning");
  });

  it("lists every contributing source with a concrete fact", () => {
    const input = base({
      journeys: [{ twin_id: "t2", status: "active", tasks: [{ id: "it", title: "IT", status: "blocked", blocked: { note: "x" } }] }],
    });
    const recs = scanForRecommendations(input);
    for (const r of recs) {
      for (const e of r.evidence_ledger) {
        expect(e.source.length).toBeGreaterThan(0);
        expect(e.fact.length).toBeGreaterThan(0);
      }
    }
  });

  it("mobility requires MEANINGFUL coverage of the target role, not only soft-share", () => {
    // 5 required skills, only 2 covered (both soft, via Python): the other 3
    // sit in categories Python cannot reach, so covered_ratio = 0.4 < 0.6.
    const input = base();
    input.twins[0].verified_skills = [{ name: "Python", proficiency: 4 }];
    input.graph = [
      { skill: "Python", category: "Data", outgoing_edges: [{ target_skill: "ETL", type: "ADJACENT_TO", weight: 0.7 }, { target_skill: "Data Modeling", type: "ADJACENT_TO", weight: 0.7 }] },
      { skill: "ETL", category: "Data", outgoing_edges: [] },
      { skill: "Data Modeling", category: "Data", outgoing_edges: [] },
      { skill: "Kubernetes", category: "DevOps", outgoing_edges: [] },
      { skill: "REST APIs", category: "Backend", outgoing_edges: [] },
      { skill: "Accessibility", category: "Design", outgoing_edges: [] },
    ];
    input.requisitions[0].required_skills = [
      { skill: "Data Modeling", target_proficiency: 3 },
      { skill: "ETL", target_proficiency: 3 },
      { skill: "Kubernetes", target_proficiency: 3 },
      { skill: "REST APIs", target_proficiency: 3 },
      { skill: "Accessibility", target_proficiency: 3 },
    ];
    const recs = scanForRecommendations(input);
    expect(recs.find((r) => r.category === "INTERNAL_MOBILITY")).toBeUndefined();
  });

  it("mobility evaluates ALL requisitions, picks the best, and lists alternatives", () => {
    const input = base();
    input.twins[0].verified_skills = [{ name: "Python", proficiency: 4 }];
    input.graph = [
      { skill: "Python", category: "Data", outgoing_edges: [{ target_skill: "Data Modeling", type: "ADJACENT_TO", weight: 0.7 }, { target_skill: "ETL", type: "ADJACENT_TO", weight: 0.7 }] },
      { skill: "Data Modeling", category: "Data", outgoing_edges: [] },
      { skill: "ETL", category: "Data", outgoing_edges: [] },
      { skill: "Kubernetes", category: "DevOps", outgoing_edges: [] },
    ];
    // Both reqs eligible (covered_ratio >= 0.6); req-small has full coverage.
    input.requisitions = [
      { id: "req-small", title: "Junior Data Engineer", required_skills: [{ skill: "Data Modeling", target_proficiency: 3 }, { skill: "ETL", target_proficiency: 3 }], future_skills: [], seniority_level: 3 },
      { id: "req-big", title: "Data Engineer", required_skills: [{ skill: "Data Modeling", target_proficiency: 3 }, { skill: "ETL", target_proficiency: 3 }, { skill: "Kubernetes", target_proficiency: 3 }], future_skills: [], seniority_level: 3 },
    ];
    const recs = scanForRecommendations(input);
    const mobility = recs.find((r) => r.category === "INTERNAL_MOBILITY");
    expect(mobility).toBeDefined();
    expect(mobility!.resource_ref).toBe("req-small"); // best coverage picked
    expect(mobility!.alternatives?.some((a) => a.req_id === "req-big")).toBe(true);
  });

  it("recruitment recommendations REQUIRE an actual application record", () => {
    // Candidate with unverified claims but NO application row -> no rec.
    const noApp = base({
      twins: [
        {
          id: "c1",
          name: "Keyword Heavy",
          role: "candidate",
          status: "active",
          signals: [],
          performance_history: [],
          verified_skills: [{ name: "Go", proficiency: 3 }],
          seniority_level: 3,
        },
      ],
      applications: [],
    });
    expect(scanForRecommendations(noApp).some((r) => r.category === "RECRUITMENT_ASSESSMENT_REVIEW")).toBe(false);

    // Same candidate WITH an application row + unverified claims -> fires.
    const withApp = base({
      twins: [
        {
          id: "c1",
          name: "Keyword Heavy",
          role: "candidate",
          status: "candidate", // candidates carry status 'candidate', not 'active'
          signals: [],
          performance_history: [],
          verified_skills: [{ name: "Go", proficiency: 3 }],
          seniority_level: 3,
        },
      ],
      applications: [{ twin_id: "c1", requisition_id: "req-a", stage: "technical_interview", application_code: "WS-1", unverified_claims: 3 }],
    });
    const recs = scanForRecommendations(withApp);
    const rec = recs.find((r) => r.category === "RECRUITMENT_ASSESSMENT_REVIEW");
    expect(rec).toBeDefined();
    expect(rec!.twin_id).toBe("c1");
    expect(rec!.required_signoff_role).toBe("recruiter");
    expect(rec!.evidence_ledger.some((e) => e.source === "APPLICATION")).toBe(true);
  });
});
