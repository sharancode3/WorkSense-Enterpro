import { describe, expect, it } from "vitest";
import {
  computePerformanceFacts,
  performanceSourceHash,
  validatePerformanceCitations,
  type PerformanceInput,
} from "./performance-intelligence.ts";

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

describe("performance-intelligence (Phase 7 — defensibility)", () => {
  it("every source fact carries a resolvable record period", () => {
    const f = computePerformanceFacts(
      base({
        computed_at: "2026-09-15T00:00:00Z",
        evidence_items: [{ source_type: "work_sample", quote: "Led the migration to dbt.", captured_at: "2026-03-10T00:00:00Z" }],
      })
    );
    for (const sf of f.source_facts) {
      if (sf.source.startsWith("PERFORMANCE") || sf.source.startsWith("FEEDBACK")) {
        expect(sf.period).toBeTruthy();
      }
      if (sf.source.startsWith("EVIDENCE")) {
        expect(sf.period).toBe("2026-03");
      }
      expect(sf.ref).toMatch(/^S\d+$/);
    }
  });

  it("flags stale feedback and stale work evidence", () => {
    const f = computePerformanceFacts(
      base({
        computed_at: "2026-09-15T00:00:00Z",
        performance_history: [
          { cycle: "2023-H2", rating: "On Track", feedback: [{ sentiment: "positive", text: "Old praise.", date: "2023-11-01" }] },
        ],
        evidence_items: [{ source_type: "work_sample", quote: "Old artifact.", captured_at: "2024-01-10T00:00:00Z" }],
      })
    );
    expect(f.stale_evidence.some((s) => s.kind === "stale_feedback")).toBe(true);
    expect(f.stale_evidence.some((s) => s.kind === "stale_work_evidence")).toBe(true);
    expect(f.sparse_evidence.flags.some((fl) => fl.includes("stale"))).toBe(true);
  });

  it("detects evidence gaps for development actions (spec item 15)", () => {
    const f = computePerformanceFacts(
      base({
        verified_skills: [
          { name: "Python", proficiency: 4, verification_rigor: "high" },
          { name: "Go", proficiency: 4, verification_rigor: "claimed" },
          { name: "Statistics", proficiency: 2, verification_rigor: "medium" },
        ],
      })
    );
    const goGap = f.evidence_gaps.find((g) => g.skill === "Go");
    const statsGap = f.evidence_gaps.find((g) => g.skill === "Statistics");
    expect(goGap?.gap).toContain("no verified evidence");
    expect(statsGap?.gap).toContain("below the working bar");
  });

  it("distinguishes history states honestly", () => {
    expect(computePerformanceFacts({ performance_history: [] }).history_state).toBe("none");
    expect(computePerformanceFacts({ performance_history: [{ cycle: "2026-H1", rating: "On Track" }] }).history_state).toBe("partial");
    expect(computePerformanceFacts(base()).history_state).toBe("adequate");
  });

  it("exposes work artifacts with source type and capture period", () => {
    const f = computePerformanceFacts(
      base({
        evidence_items: [{ source_type: "work_sample", quote: "Led the migration to dbt with measurable latency wins.", captured_at: "2026-03-10T00:00:00Z" }],
      })
    );
    expect(f.work_artifacts.length).toBeGreaterThan(0);
    expect(f.work_artifacts[0].source_type).toBe("work_sample");
    expect(f.work_artifacts[0].period).toBe("2026-03");
  });

  it("citation validation rejects unknown refs and accepts valid ones", () => {
    const f = computePerformanceFacts(base());
    const refs = f.source_facts.map((sf) => sf.ref);
    const ok = validatePerformanceCitations([`Delivered strongly [${refs[0]}] and [${refs[1]}]`], refs);
    expect(ok).toEqual([]);
    // Bare "S#" form is accepted too (the model emits both bracket styles).
    const bare = validatePerformanceCitations([`Owned the metrics dashboard (${refs[2]}, ${refs[3]})`], refs);
    expect(bare).toEqual([]);
    const bad = validatePerformanceCitations([`Claim [S99] not real`], refs);
    expect(bad.length).toBeGreaterThan(0);
    const none = validatePerformanceCitations([`No citation here`], refs);
    expect(none.some((e) => e.includes("without any source citation"))).toBe(true);
  });
});
