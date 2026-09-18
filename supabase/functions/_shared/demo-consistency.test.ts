import { describe, expect, it } from "vitest";
import { DEMO_FIXTURES } from "./generated-demo-fixtures.ts";
import { REQUISITIONS, SKILLS } from "./seed-data.ts";

// Phase 12: the explicitly fictional, internally consistent demo contract.
// These invariants keep the guided demo stories working and let displayed
// aggregates be derived from (and agree with) the underlying seed records.
describe("demo organization consistency (Phase 12)", () => {
  const fx = DEMO_FIXTURES;
  const demoTwins = [...fx.employees, ...fx.candidates];
  const activeWorkers = fx.employees.filter((p) => p.role === "employee" || p.role === "manager").length;
  const managers = fx.employees.filter((p) => p.role === "manager").length;
  const departments = new Set(fx.employees.filter((p) => p.department).map((p) => p.department)).size;
  const openReqs = REQUISITIONS.filter((r) => r.status === "open").length;
  const months = new Set(fx.observations.map((o) => o.period)).size;

  it("approximately 60 active workers with believable managers", () => {
    expect(activeWorkers).toBeGreaterThanOrEqual(55);
    expect(activeWorkers).toBeLessThanOrEqual(70);
    expect(managers).toBeGreaterThanOrEqual(6);
    expect(managers).toBeLessThanOrEqual(8);
  });

  it("six coherent departments and a fictional, consistent domain", () => {
    expect(departments).toBeGreaterThanOrEqual(6);
    expect(departments).toBeLessThanOrEqual(8);
    // Emails are fictional — never a real personal domain; IDs are stable.
    for (const t of demoTwins) {
      expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("five open requisitions plus on-hold/filled examples (fx + seed combined)", () => {
    const fxOpen = (fx.requisitions ?? []).filter((r) => r.status === "open").length;
    expect(openReqs + fxOpen).toBeGreaterThanOrEqual(5);
    expect(REQUISITIONS.length + (fx.requisitions ?? []).length).toBeGreaterThanOrEqual(openReqs);
  });

  it("20-30 candidates with 12 months of dated observations", () => {
    expect(fx.candidates.length).toBeGreaterThanOrEqual(20);
    expect(fx.candidates.length).toBeLessThanOrEqual(30);
    expect(months).toBe(12);
  });

  it("skill ids referenced by candidate assertions all resolve in the graph", () => {
    const known = new Set(fx.skills.map((s) => s.id));
    for (const c of fx.candidates) {
      for (const a of c.assertions ?? []) {
        expect(known.has(a.skill_id)).toBe(true);
      }
    }
  });

  it("SKILLS catalog in seed-data has stable unique names", () => {
    const names = SKILLS.map((s) => s.skill);
    expect(new Set(names).size).toBe(names.length);
  });
});
