import { describe, expect, it } from "vitest";
import { visibleSections, type NavSection } from "@/lib/navigation";
import { ROLES, type Role } from "@/lib/rbac";

/** The exact destination list a role may open, in sidebar order. */
function routesFor(role: Role): string[] {
  return visibleSections(role).flatMap((s) => s.items.map((i) => i.to));
}

describe("role-aware navigation (Batch 1.1)", () => {
  it("filters items individually, not only whole sections", () => {
    // IT may open Overview + My Day + Onboarding only — "My work" must NOT
    // drag in the Recommendation hub, and no other section may appear.
    expect(routesFor("it_security")).toEqual(["/app", "/my-day", "/onboarding"]);

    // Recruiter must NOT see Workforce review just because Skill graph is
    // visible inside the same "People" section.
    expect(routesFor("recruiter")).toEqual(["/app", "/my-day", "/graph", "/recruitment", "/policy"]);

    // HR partner gets graph access but no recruitment or administration.
    expect(routesFor("hr_partner")).toEqual([
      "/app",
      "/my-day",
      "/onboarding",
      "/hub",
      "/workforce",
      "/graph",
      "/staffing",
      "/policy",
    ]);

    // Administrator keeps the full workspace including Administration.
    expect(routesFor("hr_executive")).toEqual([
      "/app",
      "/my-day",
      "/onboarding",
      "/hub",
      "/workforce",
      "/graph",
      "/recruitment",
      "/staffing",
      "/policy",
      "/admin/access",
      "/status",
      "/workforce/data-quality",
    ]);

    // Manager: team-focused, no recruitment or administration.
    expect(routesFor("manager")).toEqual(["/app", "/my-day", "/onboarding", "/hub", "/workforce", "/graph", "/staffing", "/policy"]);

    // Employee: self-service home, onboarding, workforce (self) and graph (self).
    expect(routesFor("employee")).toEqual(["/app", "/my-day", "/onboarding", "/workforce", "/graph", "/policy"]);

    // Candidate has no app-shell destinations.
    expect(routesFor("candidate")).toEqual([]);
  });

  it("drops sections that end up empty and preserves original config", () => {
    const recruiterSections = visibleSections("recruiter");
    expect(recruiterSections.map((s) => s.key)).toEqual(["my-work", "people", "hiring", "policies"]);
    // No Administration, planning or "people" entries beyond the graph.
    expect(recruiterSections.some((s) => s.items.some((i) => i.to === "/workforce"))).toBe(false);
    expect(recruiterSections.some((s) => s.items.some((i) => i.to === "/staffing"))).toBe(false);
  });

  it("returns new section objects and never mutates the navigation config", () => {
    const a = visibleSections("manager");
    const b = visibleSections("manager");
    expect(a).toEqual(b);
    // Different array instances each call.
    expect(a).not.toBe(b);
    // Items that a role cannot open are simply absent from the returned model.
    for (const s of visibleSections("it_security")) {
      for (const item of s.items) {
        expect(["/app", "/my-day", "/onboarding"]).toContain(item.to);
      }
    }
  });

  it("covers every role without throwing", () => {
    for (const role of ROLES) {
      const sections: NavSection[] = visibleSections(role);
      expect(Array.isArray(sections)).toBe(true);
    }
  });
});
