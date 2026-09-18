import { describe, expect, it } from "vitest";
import {
  computeTotalYears,
  normalizeSkillName,
  quoteMatchesSource,
  sanitizeFileName,
  sniffDocType,
} from "./resume.ts";
import { validateResumeReview } from "./validate.ts";

const GRAPH = [
  { skill: "PostgreSQL", aliases: ["postgres", "pg", "postgresql"] },
  { skill: "Go", aliases: ["golang"] },
  { skill: "Kubernetes", aliases: ["k8s"] },
];

describe("sniffDocType", () => {
  it("detects PDF and DOCX (zip) from magic bytes, not the extension", () => {
    expect(sniffDocType(new TextEncoder().encode("%PDF-1.7 …"))).toBe("pdf");
    expect(sniffDocType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBe("docx");
    expect(sniffDocType(new Uint8Array([1, 2, 3, 4]))).toBe("unknown");
  });
});

describe("sanitizeFileName", () => {
  it("strips paths and control characters and caps length", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("resume (final).pdf")).toBe("resume (final).pdf");
    expect(sanitizeFileName("a\u0000b.pdf")).toBe("ab.pdf");
  });
});

describe("normalizeSkillName", () => {
  it("maps aliases to the canonical taxonomy skill", () => {
    expect(normalizeSkillName(GRAPH, "postgres")).toBe("PostgreSQL");
    expect(normalizeSkillName(GRAPH, "Postgres")).toBe("PostgreSQL");
    expect(normalizeSkillName(GRAPH, "golang")).toBe("Go");
    expect(normalizeSkillName(GRAPH, "K8S")).toBe("Kubernetes");
  });
  it("keeps exact matches and unknown names unchanged", () => {
    expect(normalizeSkillName(GRAPH, "Go")).toBe("Go");
    expect(normalizeSkillName(GRAPH, "COBOL")).toBe("COBOL");
  });
});

describe("quoteMatchesSource", () => {
  it("accepts verbatim quotes under whitespace normalization", () => {
    expect(quoteMatchesSource("Built Go microservices", "Led teams. Built  Go  microservices\nsince 2019.")).toBe(true);
  });
  it("rejects fabricated quotes", () => {
    expect(quoteMatchesSource("Managed a 100-person org", "Full-stack engineer with 4 years experience.")).toBe(false);
  });
});

describe("computeTotalYears", () => {
  it("does not double-count overlapping employment", () => {
    const clock = "2026-01-15T00:00:00Z";
    const r = computeTotalYears(
      [
        { title: "A", start: "2020-01", end: "2023-12" },
        { title: "B", start: "2023-06", end: "present" },
      ],
      clock
    );
    expect(r.total_years).toBeCloseTo(6.0, 0);
    expect(r.overlap_warnings.some((w) => w.includes("Overlapping"))).toBe(true);
  });
  it("keeps unknown dates unknown (excluded from the total)", () => {
    const r = computeTotalYears(
      [
        { title: "A", start: "unknown", end: "2022-06" },
        { title: "B", start: "2018-01", end: "present" },
      ],
      "2026-01-01T00:00:00Z"
    );
    expect(r.total_years).toBeGreaterThanOrEqual(7);
    expect(r.overlap_warnings.some((w) => w.includes("unknown"))).toBe(true);
  });
});

describe("validateResumeReview", () => {
  const good = {
    full_name: "Ada Example",
    contact: { email: "ada@example.com", phone: "", location: "Berlin", linkedin: "" },
    roles: [{ title: "Engineer", company: "Acme", start: "2020-01", end: "present", years_claimed: 6, quote: "Built Go services" }],
    education: [{ institution: "TU Berlin", degree: "MSc", year: "2018", quote: "MSc Computer Science" }],
    certifications: [],
    projects: [{ name: "x", role: "lead", tech_stack: ["Go"], impact_metric: "30%", quote: "reduced p99" }],
    skill_claims: [{ skill: "Go", years: 6, proficiency_tier: "ADVANCED", quote: "Built Go services", association: "explicit" }],
    ambiguities: [],
    conflicts: [],
  };
  it("accepts a well-formed review payload", () => {
    expect(validateResumeReview(good).ok).toBe(true);
  });
  it("rejects fabricated projects, bad tiers and unknown associations", () => {
    const bad = {
      ...good,
      projects: [{ name: "Fake", role: "cto", tech_stack: [], impact_metric: "100x", quote: "not in source" }],
      skill_claims: [
        { skill: "Go", years: 6, proficiency_tier: "EXPERT", quote: "x", association: "made_up" },
      ],
    };
    const v = validateResumeReview(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("association"))).toBe(true);
  });
});
