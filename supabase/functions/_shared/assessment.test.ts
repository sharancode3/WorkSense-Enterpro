import { describe, expect, it } from "vitest";
import {
  answerFor,
  answersBlob,
  ASSESSMENT_SEEDS,
  defaultJudgmentFor,
  isJudgmentValue,
  normalizeJudgment,
  PEOPLE_OPS_REQUISITION,
  quoteExists,
  validateJudgmentItem,
} from "./assessment.ts";

describe("assessment blueprint seeds", () => {
  it("seeds exactly the three documented examples", () => {
    const titles = ASSESSMENT_SEEDS.map((b) => b.title);
    expect(titles.some((t) => /payments service/i.test(t))).toBe(true);
    expect(titles.some((t) => /messy dataset/i.test(t))).toBe(true);
    expect(titles.some((t) => /policy scenario/i.test(t))).toBe(true);
    expect(ASSESSMENT_SEEDS).toHaveLength(3);
  });

  it("has deterministic unique ids and one rubric per competency mapping", () => {
    const blueprintIds = new Set(ASSESSMENT_SEEDS.map((b) => b.id));
    expect(blueprintIds.size).toBe(ASSESSMENT_SEEDS.length);
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

  it("keeps every question reachable and bounded", () => {
    for (const blueprint of ASSESSMENT_SEEDS) {
      expect(blueprint.questions.length).toBeGreaterThan(0);
      const keys = new Set(blueprint.questions.map((q) => q.key));
      expect(keys.size).toBe(blueprint.questions.length);
      for (const q of blueprint.questions) {
        expect(q.prompt.length).toBeGreaterThan(20);
        expect(q.max_chars).toBeGreaterThan(0);
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

  it("accepts a well-formed evidence-linked judgment", () => {
    const errors = validateJudgmentItem(
      {
        competency: "Database performance",
        judgment: "4",
        evidence_quotes: ["EXPLAIN ANALYZE", "btree index"],
        anchor_ref: "4",
        uncertainty: 0.2,
        suggested_follow_up: "",
      },
      rubric,
      answers,
      ["q2"]
    );
    expect(errors).toEqual([]);
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
});
