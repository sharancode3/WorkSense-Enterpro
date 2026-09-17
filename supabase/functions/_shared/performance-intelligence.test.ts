import { describe, expect, it } from "vitest";
import { computePerformanceFacts, performanceSourceHash, type PerformanceInput } from "./performance-intelligence.ts";

const base = (over: Partial<PerformanceInput> = {}): PerformanceInput => ({
  performance_history: [
    {
      cycle: "2025-H2",
      rating: "On Track",
      goals_met: 90,
      feedback: [{ sentiment: "positive", text: "Delivered the reporting module." }],
      summary: "Solid cycle.",
    },
    {
      cycle: "2026-H1",
      rating: "Exceeds Expectations",
      goals_met: 95,
      feedback: [
        { sentiment: "positive", text: "Top-quartile delivery." },
        { sentiment: "negative", text: "Engagement concerns noted; seeks more scope." },
      ],
      summary: "Top-quartile delivery; engagement concerns noted.",
    },
  ],
  verified_skills: [
    { name: "Python", proficiency: 4, verification_rigor: "high" },
    { name: "Statistics", proficiency: 3, verification_rigor: "medium" },
  ],
  observations: [
    { metric: "engagement", period: "2026-04", value: 4.0, missing: false },
    { metric: "engagement", period: "2026-05", value: 3.6, missing: false },
    { metric: "engagement", period: "2026-06", value: 3.2, missing: false },
    { metric: "engagement", period: "2026-07", value: 2.9, missing: false },
  ],
  evidence_items: [{ source_type: "work_sample", quote: "Led the migration to dbt with measurable latency wins." }],
  seeking_growth: false,
  ...over,
});

describe("performance-intelligence (Phase 9)", () => {
  it("produces attributed source facts and never mixes them with inference", () => {
    const f = computePerformanceFacts(base());
    expect(f.source_facts.length).toBeGreaterThan(0);
    for (const sf of f.source_facts) {
      expect(sf.ref).toMatch(/^S\d+$/);
      expect(sf.source.length).toBeGreaterThan(0);
      expect(sf.fact.length).toBeGreaterThan(0);
    }
  });

  it("labels goal averages as directional context, not a verdict", () => {
    const f = computePerformanceFacts(base());
    expect(f.goal_stats.avg).toBe(92.5);
    expect(f.goal_stats.note).toContain("not a performance verdict");
    expect(f.feedback_stats.note).toContain("not a performance score");
  });

  it("detects feedback-vs-rating contradiction", () => {
    const f = computePerformanceFacts(base());
    const c = f.contradictions.find((x) => x.title.includes("Recorded concerns"));
    expect(c).toBeDefined();
    expect(c!.evidence.some((e) => e.includes("latest formal rating"))).toBe(true);
  });

  it("detects declining goal attainment", () => {
    const f = computePerformanceFacts(
      base({
        performance_history: [
          { cycle: "2025-H1", rating: "On Track", goals_met: 92 },
          { cycle: "2025-H2", rating: "On Track", goals_met: 70 },
          { cycle: "2026-H1", rating: "On Track", goals_met: 55 },
        ],
      })
    );
    expect(f.contradictions.some((x) => x.title.includes("Declining goal attainment"))).toBe(true);
  });

  it("flags sparse evidence explicitly", () => {
    const sparse = computePerformanceFacts({
      performance_history: [{ cycle: "2026-H1", rating: "On Track" }],
      verified_skills: [],
      evidence_items: [],
    });
    expect(sparse.sparse_evidence.flags.length).toBeGreaterThanOrEqual(3);
    expect(sparse.sparse_evidence.flags.some((fl) => fl.includes("Only 1 performance cycle"))).toBe(true);
    expect(sparse.sparse_evidence.flags.some((fl) => fl.includes("No work-evidence items"))).toBe(true);
  });

  it("marks inferred themes as inference, never diagnosis", () => {
    const f = computePerformanceFacts(base({ seeking_growth: true }));
    const growth = f.inferred_themes.find((t) => t.theme.includes("development interest"));
    expect(growth).toBeDefined();
    expect(growth!.theme).toContain("INFERRED");
    expect(growth!.theme).toContain("self-reported");
    // Contradiction wording must not claim causation.
    for (const c of f.contradictions) {
      expect(c.evidence.join(" ").toLowerCase()).not.toMatch(/causes (attrition|leaving|resignation)/);
    }
  });

  it("engagement decline + concerns yields a correlation-caveated contradiction", () => {
    const f = computePerformanceFacts(base());
    const c = f.contradictions.find((x) => x.title.includes("Engagement decline"));
    expect(c).toBeDefined();
    expect(c!.evidence.some((e) => e.includes("correlation is not a diagnosis"))).toBe(true);
  });

  it("source hash invalidates when any source row changes", () => {
    const a = base();
    expect(performanceSourceHash(a)).toBe(performanceSourceHash(base()));
    expect(performanceSourceHash(a)).not.toBe(
      performanceSourceHash(base({ performance_history: [{ cycle: "2026-H1", rating: "Exceeds Expectations", goals_met: 96 }] }))
    );
    expect(performanceSourceHash(a)).not.toBe(
      performanceSourceHash(base({ evidence_items: [...a.evidence_items!, { source_type: "resume_document", quote: "New doc." }] }))
    );
  });
});
