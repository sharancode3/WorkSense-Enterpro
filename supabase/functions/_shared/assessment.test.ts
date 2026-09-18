import { describe, expect, it } from "vitest";
import {
  answerFor,
  answersBlob,
  ASSESSMENT_SEEDS,
  computeReviewRequired,
  DIMENSION_NAMES,
  defaultJudgmentFor,
  isDimensionScore,
  isJudgmentValue,
  normalizeDimension,
  normalizeJudgment,
  PEOPLE_OPS_REQUISITION,
  questionsForCompetency,
  quoteExists,
  SESSION_TYPES,
  validateJudgmentItem,
} from "./assessment.ts";

describe("assessment blueprint seeds", () => {
  it("seeds the documented examples across all three formats", () => {
    const kinds = new Set(ASSESSMENT_SEEDS.map((b) => b.kind));
    expect(kinds.has("work_sample")).toBe(true);
    expect(kinds.has("interview")).toBe(true);
    expect(kinds.has("knowledge_assessment")).toBe(true);
    const titles = ASSESSMENT_SEEDS.map((b) => b.title);
    expect(titles.some((t) => /payments service/i.test(t))).toBe(true);
    expect(titles.some((t) => /production incident interview/i.test(t))).toBe(true);
    expect(titles.some((t) => /core backend knowledge/i.test(t))).toBe(true);
    expect(titles.some((t) => /messy dataset/i.test(t))).toBe(true);
    expect(titles.some((t) => /policy scenario/i.test(t))).toBe(true);
    expect(ASSESSMENT_SEEDS).toHaveLength(5);
  });

  it("does not reuse content between formats for the same requisition", () => {
    for (const requisition_id of new Set(ASSESSMENT_SEEDS.map((b) => b.requisition_id))) {
      const forReq = ASSESSMENT_SEEDS.filter((b) => b.requisition_id === requisition_id);
      if (forReq.length < 2) continue;
      const allPrompts = forReq.flatMap((b) => b.questions.map((q) => q.prompt.trim().toLowerCase()));
      expect(new Set(allPrompts).size).toBe(allPrompts.length);
      for (const b of forReq) {
        for (const q of b.questions) {
          const others = forReq.filter((o) => o.id !== b.id);
          for (const o of others) {
            for (const oq of o.questions) {
              expect(q.prompt).not.toBe(oq.prompt);
              expect(q.prompt.toLowerCase()).not.toContain(oq.prompt.slice(0, 40).toLowerCase());
            }
          }
        }
      }
    }
  });

  it("maps every question to at least one rubric competency that exists", () => {
    for (const blueprint of ASSESSMENT_SEEDS) {
      const comps = blueprint.rubrics.map((r) => r.competency.toLowerCase());
      for (const q of blueprint.questions) {
        expect(q.criteria.length).toBeGreaterThan(0);
        for (const c of q.criteria) {
          expect(comps).toContain(c.toLowerCase());
        }
      }
    }
  });

  it("keeps core questions stable (comparative core) and bounded", () => {
    for (const blueprint of ASSESSMENT_SEEDS) {
      expect(blueprint.questions.length).toBeGreaterThan(0);
      const keys = new Set(blueprint.questions.map((q) => q.key));
      expect(keys.size).toBe(blueprint.questions.length);
      for (const q of blueprint.questions) {
        expect(q.is_core).toBe(true);
        expect(q.prompt.length).toBeGreaterThan(20);
        expect(q.max_chars).toBeGreaterThan(0);
      }
    }
  });

  it("only knowledge assessments carry answer keys (never shown to candidates)", () => {
    for (const blueprint of ASSESSMENT_SEEDS) {
      const hasKeys = blueprint.questions.some((q) => q.answer_key);
      expect(hasKeys).toBe(blueprint.kind === "knowledge_assessment");
      if (blueprint.kind === "knowledge_assessment") {
        for (const q of blueprint.questions) expect((q.answer_key ?? "").length).toBeGreaterThan(20);
      }
    }
  });

  it("has deterministic unique ids and one rubric per competency mapping", () => {
    const blueprintIds = new Set(ASSESSMENT_SEEDS.map((b) => b.id));
    expect(blueprintIds.size).toBe(ASSESSMENT_SEEDS.length);
    const rubricIds = ASSESSMENT_SEEDS.flatMap((b) => b.rubrics.map((r) => r.id));
    expect(new Set(rubricIds).size).toBe(rubricIds.length);
    for (const blueprint of ASSESSMENT_SEEDS) {
      expect(blueprint.rubrics.length).toBeGreaterThan(0);
      for (const rubric of blueprint.rubrics) {
        expect(rubric.blueprint_id ?? blueprint.id).toBe(blueprint.id);
        expect(Object.keys(rubric.anchors)).toEqual(["1", "2", "3", "4", "5"]);
        expect(rubric.critical_mistakes.length).toBeGreaterThan(0);
        expect(rubric.insufficient_evidence_conditions.length).toBeGreaterThan(0);
        expect(rubric.skill_mapping.skill.length).toBeGreaterThan(0);
      }
    }
  });

  it("maps supported anchors to proficiencies only from 3 upward", () => {
    for (const blueprint of ASSESSMENT_SEEDS) {
      for (const rubric of blueprint.rubrics) {
        const levels = Object.keys(rubric.skill_mapping.anchor_to_proficiency).map(Number);
        for (const level of levels) expect(level).toBeGreaterThanOrEqual(3);
        for (const [level, prof] of Object.entries(rubric.skill_mapping.anchor_to_proficiency)) {
          expect(Number(level)).toBe(prof);
        }
      }
    }
  });

  it("hosts the People Ops blueprint on a real demo requisition", () => {
    const peopleOps = ASSESSMENT_SEEDS.find((b) => /policy scenario/i.test(b.title));
    expect(peopleOps?.requisition_id).toBe(PEOPLE_OPS_REQUISITION.id);
    expect(PEOPLE_OPS_REQUISITION.required_skills.length).toBeGreaterThan(0);
  });
});

describe("judgment vocabulary", () => {
  it("accepts the documented values", () => {
    for (const v of ["1", "2", "3", "4", "5", "NOT_ASSESSED", "INSUFFICIENT_EVIDENCE"]) {
      expect(isJudgmentValue(v)).toBe(true);
    }
    expect(isJudgmentValue("6")).toBe(false);
    expect(isJudgmentValue("elite")).toBe(false);
  });

  it("normalizes numeric scores into the vocabulary", () => {
    expect(normalizeJudgment(4)).toBe("4");
    expect(normalizeJudgment("3")).toBe("3");
    expect(normalizeJudgment(9)).toBe("NOT_ASSESSED");
    expect(normalizeJudgment(undefined)).toBe("NOT_ASSESSED");
  });

  it("accepts dimension scores and normalizes them", () => {
    expect(isDimensionScore("NA")).toBe(true);
    expect(isDimensionScore("5")).toBe(true);
    expect(isDimensionScore("6")).toBe(false);
    expect(normalizeDimension(4)).toBe("4");
    expect(normalizeDimension("NA")).toBe("NA");
    expect(normalizeDimension("9")).toBe("NA");
  });

  it("enumerates the four judged dimensions", () => {
    expect(DIMENSION_NAMES).toEqual(["correctness", "reasoning", "trade_offs", "communication"]);
  });
});

describe("question → criteria mapping", () => {
  it("finds the questions that produce evidence for a competency", () => {
    const questions = [
      { key: "q1", criteria: ["A", "B"] },
      { key: "q2", criteria: ["B"] },
      { key: "q3", criteria: ["C"] },
    ];
    expect(questionsForCompetency(questions, "A")).toEqual(["q1"]);
    expect(questionsForCompetency(questions, "b")).toEqual(["q1", "q2"]);
    expect(questionsForCompetency(questions, "C")).toEqual(["q3"]);
  });

  it("falls back to positional pairing when criteria are absent (backward compat)", () => {
    const questions = [{ key: "q1" }, { key: "q2" }];
    expect(questionsForCompetency(questions, "Anything", 1)).toEqual(["q2"]);
  });
});

describe("reviewer-confirmation routing", () => {
  it("flags high-uncertainty judgments for human confirmation", () => {
    expect(computeReviewRequired(0.9, {})).toBe(true);
    expect(computeReviewRequired(0.1, {})).toBe(false);
    expect(computeReviewRequired(undefined, undefined)).toBe(false);
  });

  it("flags contradictory dimension scores (correctness high, reasoning low)", () => {
    expect(computeReviewRequired(0.1, { correctness: "5", reasoning: "1", trade_offs: "3" })).toBe(true);
    expect(computeReviewRequired(0.1, { correctness: "5", reasoning: "4", communication: "4" })).toBe(false);
    expect(computeReviewRequired(0.1, { correctness: "5", reasoning: "NA" })).toBe(false);
  });

  it("marks missing/short answers as requiring review", () => {
    const missing = defaultJudgmentFor({ q1: "" }, "q1", { competency: "X" });
    expect(missing.review_required).toBe(true);
    expect(missing.judgment).toBe("NOT_ASSESSED");
    const short = defaultJudgmentFor({ q1: "ok" }, "q1", { competency: "X" });
    expect(short.judgment).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("quote + answer helpers", () => {
  it("finds verbatim quotes case-insensitively", () => {
    expect(quoteExists("idempotency key", "I would use an Idempotency Key per event.")).toBe(true);
    expect(quoteExists("unique constraint", "no constraint mentioned anywhere")).toBe(false);
    expect(quoteExists("  ", "anything")).toBe(false);
  });

  it("flattens object and string answer shapes", () => {
    expect(answerFor({ q1: "plain" }, "q1")).toBe("plain");
    expect(answerFor({ q1: { answer: "nested" } }, "q1")).toBe("nested");
    expect(answerFor({}, "q1")).toBe("");
    expect(answersBlob({ q1: { answer: "a" }, q2: "b" })).toContain("a");
    expect(answersBlob({ q1: { answer: "a" }, q2: "b" })).toContain("b");
  });
});

describe("judgment item validation", () => {
  const rubric = {
    competency: "Database performance",
    anchors: { "1": "bad", "2": "weak", "3": "ok", "4": "good", "5": "great" },
  };
  const answers = { q2: "I would run EXPLAIN ANALYZE and add a btree index on orders(user_id)." };

  it("accepts a well-formed evidence-linked judgment with dimensions", () => {
    const errors = validateJudgmentItem(
      {
        competency: "Database performance",
        judgment: "4",
        evidence_quotes: ["EXPLAIN ANALYZE", "btree index"],
        anchor_ref: "4",
        uncertainty: 0.2,
        suggested_follow_up: "",
        dimensions: { correctness: "4", reasoning: "5", trade_offs: "3", communication: "4" },
      },
      rubric,
      answers,
      ["q2"]
    );
    expect(errors).toEqual([]);
  });

  it("rejects invalid dimension names and scores", () => {
    const badName = validateJudgmentItem(
      { competency: "Database performance", judgment: "4", evidence_quotes: [], dimensions: { speed: "4" } },
      rubric,
      answers,
      ["q2"]
    );
    expect(badName.some((e) => /dimension "speed"/i.test(e))).toBe(true);

    const badScore = validateJudgmentItem(
      { competency: "Database performance", judgment: "4", evidence_quotes: [], dimensions: { reasoning: "8" } },
      rubric,
      answers,
      ["q2"]
    );
    expect(badScore.some((e) => /dimension "reasoning"/i.test(e))).toBe(true);
  });

  it("rejects quotes that are not in the answer", () => {
    const errors = validateJudgmentItem(
      {
        competency: "Database performance",
        judgment: "4",
        evidence_quotes: ["I built a massive cache farm"],
        anchor_ref: "4",
      },
      rubric,
      answers,
      ["q2"]
    );
    expect(errors.some((e) => /evidence quote not found/i.test(e))).toBe(true);
  });

  it("rejects quotes that exceed the excerpt bound", () => {
    const errors = validateJudgmentItem(
      {
        competency: "Database performance",
        judgment: "4",
        evidence_quotes: ["x".repeat(700)],
        anchor_ref: "4",
      },
      rubric,
      answers,
      ["q2"]
    );
    expect(errors.some((e) => /excerpt bound/i.test(e))).toBe(true);
  });

  it("rejects out-of-range scores and unknown competencies", () => {
    const bad = validateJudgmentItem(
      { competency: "Database performance", judgment: "7", evidence_quotes: [], anchor_ref: "7" },
      rubric,
      answers,
      ["q2"]
    );
    expect(bad.length).toBeGreaterThan(0);

    const wrongComp = validateJudgmentItem(
      { competency: "Knitting", judgment: "3", evidence_quotes: [], anchor_ref: "3" },
      rubric,
      answers,
      ["q2"]
    );
    expect(wrongComp.some((e) => /does not match/i.test(e))).toBe(true);
  });

  it("rejects an anchor_ref pointing at a nonexistent level", () => {
    const errors = validateJudgmentItem(
      { competency: "Database performance", judgment: "3", evidence_quotes: [], anchor_ref: "9" },
      rubric,
      answers,
      ["q2"]
    );
    expect(errors.some((e) => /anchor_ref/i.test(e))).toBe(true);
  });

  it("defaults missing and short answers without fabricating scores", () => {
    const missing = defaultJudgmentFor({ q2: "" }, "q2", rubric);
    expect(missing.judgment).toBe("NOT_ASSESSED");

    const short = defaultJudgmentFor({ q2: "ok" }, "q2", rubric);
    expect(short.judgment).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("only defines the three documented session types", () => {
    expect(SESSION_TYPES).toEqual(["work_sample", "interview", "knowledge_assessment"]);
  });
});
