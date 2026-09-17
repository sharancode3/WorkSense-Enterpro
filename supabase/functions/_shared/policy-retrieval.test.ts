import { describe, expect, it } from "vitest";
import {
  ABSTENTION_THRESHOLD,
  flattenPolicies,
  normalizeForMatch,
  retrieveChunks,
  validateCitations,
  type PolicyDoc,
} from "./policy-retrieval.ts";
import { POLICIES } from "./seed-data.ts";

const docs = POLICIES as unknown as PolicyDoc[];

describe("policy corpus", () => {
  it("is pre-chunked with stable doc_code + section headings", () => {
    const chunks = flattenPolicies(docs);
    expect(chunks.length).toBeGreaterThanOrEqual(12);
    for (const c of chunks) {
      expect(c.doc_code).toMatch(/^POL-/);
      expect(c.heading.length).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });
});

describe("deterministic retrieval + abstention gate", () => {
  it("retrieves the right doc for a covered question, above the threshold", () => {
    const res = retrieveChunks(docs, "How many days of annual leave do I get per year?");
    expect(res[0].doc_code).toBe("POL-LVE");
    expect(res[0].score).toBeGreaterThan(ABSTENTION_THRESHOLD);
  });

  it("retrieves remote-work doc for a full-time remote question", () => {
    const res = retrieveChunks(docs, "Is full-time remote work allowed with written approval?");
    expect(res[0].doc_code).toBe("POL-RMT");
    expect(res[0].score).toBeGreaterThan(ABSTENTION_THRESHOLD);
  });

  it("ABSTAINS on an uncovered question — below the threshold, no LLM call needed", () => {
    const res = retrieveChunks(docs, "What is the policy on sabbaticals, pet insurance and parking passes?");
    expect(res[0].score).toBeLessThan(ABSTENTION_THRESHOLD);
  });

  it("returns top-3 chunks ordered by score", () => {
    const res = retrieveChunks(docs, "How much can I claim for a certification course?");
    expect(res.length).toBe(3);
    expect(res[0].score).toBeGreaterThanOrEqual(res[1].score);
    expect(res[0].doc_code).toBe("POL-LND");
  });
});

describe("citation validator", () => {
  const chunks = retrieveChunks(docs, "annual leave days");

  it("accepts a quote that is verbatim (fuzzy) in the retrieved chunk", () => {
    const quote = "Employees accrue 24 days of paid annual leave per year";
    const { valid, droppedCount } = validateCitations(
      [{ claim: "24 days", doc_code: "POL-LVE", section: "s1", quote }],
      chunks
    );
    expect(droppedCount).toBe(0);
    expect(valid.length).toBe(1);
  });

  it("drops a fabricated quote that appears nowhere in the chunks", () => {
    const { valid, droppedCount } = validateCitations(
      [{ claim: "sabbatical after 1 year", doc_code: "POL-LVE", section: "s1", quote: "every employee gets a fully paid sabbatical quarter" }],
      chunks
    );
    expect(droppedCount).toBe(1);
    expect(valid.length).toBe(0);
  });

  it("normalizes whitespace and case for quote matching", () => {
    expect(normalizeForMatch("  Accrue  24 Days ")).toContain("accrue 24 days");
  });
});
