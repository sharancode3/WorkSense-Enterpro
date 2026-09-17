import { describe, expect, it } from "vitest";
import {
  ABSTENTION_THRESHOLD,
  applicabilityOk,
  bestExpiredHit,
  currentVersionSet,
  exclusiveQuestionTokens,
  filterByWindow,
  flattenPolicies,
  missingApplicability,
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
      [{ claim: "24 days", doc_code: "POL-LVE", section: "s1", exact_quote: quote }],
      chunks
    );
    expect(droppedCount).toBe(0);
    expect(valid.length).toBe(1);
  });

  it("drops a fabricated quote that appears nowhere in the chunks", () => {
    const { valid, droppedCount } = validateCitations(
      [{ claim: "sabbatical after 1 year", doc_code: "POL-LVE", section: "s1", exact_quote: "every employee gets a fully paid sabbatical quarter" }],
      chunks
    );
    expect(droppedCount).toBe(1);
    expect(valid.length).toBe(0);
  });

  it("normalizes whitespace and case for quote matching", () => {
    expect(normalizeForMatch("  Accrue  24 Days ")).toContain("accrue 24 days");
  });
});

describe("Phase 7 — date window, supersession, applicability", () => {
  const V1: PolicyDoc = {
    id: "d1", doc_code: "POL-LVE", version: 1, title: "Leave v1", category: "Benefits",
    effective_from: "2025-01-01", effective_to: null,
    sections: [{ code: "s1", heading: "Carryover", text: "Unused leave carries over up to five days into the following leave year." }],
  };
  const V2: PolicyDoc = {
    id: "d2", doc_code: "POL-LVE", version: 2, title: "Leave v2", category: "Benefits",
    effective_from: "2026-01-01", effective_to: null, supersedes_doc_id: "d1",
    sections: [
      { code: "s1", heading: "Carryover", text: "Unused leave carries over up to three days into the following leave year." },
      { code: "s2", heading: "Mid-year joins", text: "Employees who join part-way through the leave year accrue for the months they are employed." },
    ],
  };
  const EXPIRED: PolicyDoc = {
    id: "d3", doc_code: "POL-CAT", version: 1, title: "Catering", category: "Workplace",
    effective_from: "2024-01-01", effective_to: "2024-12-31",
    sections: [{ code: "s1", heading: "Coverage", text: "Reimburses up to 150 per month for catering expenses." }],
  };
  const EU_ONLY: PolicyDoc = {
    id: "d4", doc_code: "POL-RMT-EU", version: 1, title: "EU Remote", category: "Workplace",
    effective_from: "2026-02-01", effective_to: null, applicable_locations: ["EU"],
    sections: [{ code: "s1", heading: "Exception", text: "EU employees may work remotely up to four days per week without approval." }],
  };

  it("resolves the current version set: newest version wins, superseded dropped", () => {
    const cur = currentVersionSet([V1, V2, EXPIRED, EU_ONLY], "2026-09-15");
    const codes = cur.map((d) => d.doc_code);
    expect(codes).toContain("POL-LVE");
    expect(cur.find((d) => d.doc_code === "POL-LVE")?.version).toBe(2);
    expect(cur.find((d) => d.id === "d1")).toBeUndefined(); // superseded by v2
    expect(cur.find((d) => d.id === "d3")).toBeUndefined(); // out of window
  });

  it("keeps both versions when the supersession is not explicit", () => {
    const withoutSupersede = currentVersionSet([V1, { ...V2, supersedes_doc_id: null }], "2026-09-15");
    expect(withoutSupersede.map((d) => d.id)).toEqual(["d2"]); // max version per code still wins
  });

  it("applies the date window honestly", () => {
    const inWindow = filterByWindow([V1, EXPIRED], "2026-09-15");
    expect(inWindow.map((d) => d.id)).toEqual(["d1"]);
  });

  it("applies location/worker-type applicability filters", () => {
    expect(applicabilityOk(EU_ONLY, { location: "EU" })).toBe(true);
    expect(applicabilityOk(EU_ONLY, { location: "US" })).toBe(false);
    expect(applicabilityOk(EU_ONLY, { location: "US", worker_type: "full_time" })).toBe(false);
  });

  it("flags missing applicability fields instead of assuming", () => {
    expect(missingApplicability(EU_ONLY, {})).toContain("location");
    expect(missingApplicability(EU_ONLY, { location: "EU" })).toEqual([]);
    expect(missingApplicability(V2, {})).toEqual([]); // All-applicable doc needs nothing
  });

  it("detects a retired/expired policy for a matching question", () => {
    const hit = bestExpiredHit([V1, EXPIRED], "how much is the catering reimbursement?", "2026-09-15");
    expect(hit?.doc_code).toBe("POL-CAT");
    expect(hit?.effective_to).toBe("2024-12-31");
  });

  it("finds exclusive tokens to disambiguate expired from generic current hits", () => {
    const curTexts = ["Employees may claim reimbursement up to 2,500 per year for role-relevant training."];
    const expiredTexts = ["The organisation reimburses up to 150 per month for catering expenses."];
    expect(exclusiveQuestionTokens("how much is the catering reimbursement?", expiredTexts, curTexts)).toContain("catering");
    // A pure leave question shares no exclusive token with the expired catering doc.
    expect(exclusiveQuestionTokens("how many days of annual leave can I carry over?", expiredTexts, curTexts)).toEqual([]);
  });
});

describe("Phase 7 — strict per-section citation validation", () => {
  const LEAVEv2: PolicyDoc = {
    id: "d2", doc_code: "POL-LVE", version: 2, title: "Leave v2", category: "Benefits",
    effective_from: "2026-01-01", effective_to: null,
    sections: [
      { code: "s1", heading: "Carryover", text: "Unused leave carries over up to three days into the following leave year." },
      { code: "s2", heading: "Mid-year joins", text: "Employees who join part-way through the leave year accrue for the months they are employed. Up to three days carry over at year-end." },
    ],
  };
  const chunks = retrieveChunks([LEAVEv2], "leave carryover", 5);

  it("accepts a quote found in the cited section", () => {
    const { valid, droppedCount } = validateCitations(
      [{ doc_code: "POL-LVE", version: 2, section: "s1", exact_quote: "carries over up to three days" }],
      chunks
    );
    expect(droppedCount).toBe(0);
    expect(valid.length).toBe(1);
  });

  it("REJECTS a quote that exists elsewhere but not in the cited section", () => {
    // "three days carry over" lives in s2 — citing s1 for it must fail.
    const { valid, droppedCount, invalidReasons } = validateCitations(
      [{ doc_code: "POL-LVE", version: 2, section: "s1", exact_quote: "three days carry over at year-end" }],
      chunks
    );
    expect(droppedCount).toBe(1);
    expect(valid.length).toBe(0);
    expect(invalidReasons[0]).toMatch(/not found in the cited section/i);
  });

  it("rejects an empty quote and a missing section", () => {
    const { droppedCount, invalidReasons } = validateCitations(
      [{ doc_code: "POL-LVE", section: "s1", exact_quote: "   " }, { doc_code: "POL-LVE", exact_quote: "carries over" }],
      chunks
    );
    expect(droppedCount).toBe(2);
    expect(invalidReasons.some((r) => /empty exact_quote/i.test(r))).toBe(true);
    expect(invalidReasons.some((r) => /missing doc_code or section/i.test(r))).toBe(true);
  });

  it("rejects a quote from a different document", () => {
    const { droppedCount } = validateCitations(
      [{ doc_code: "POL-RMT", section: "s1", exact_quote: "carries over up to three days" }],
      chunks
    );
    expect(droppedCount).toBe(1);
  });

  it("rejects a quote from the wrong version when versions are pinned", () => {
    const { droppedCount } = validateCitations(
      [{ doc_code: "POL-LVE", version: 1, section: "s1", exact_quote: "carries over up to three days" }],
      chunks
    );
    expect(droppedCount).toBe(1);
  });
});
