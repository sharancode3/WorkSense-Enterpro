import { describe, expect, it } from "vitest";
import { can, resolveLanding, ROLE_LABEL, type Role } from "@/lib/rbac";

describe("rbac", () => {
  it("maps every role to a landing route", () => {
    const roles: Role[] = ["hr_executive", "manager", "employee", "candidate"];
    for (const role of roles) {
      expect(resolveLanding(role)).toMatch(/^\//);
    }
  });

  it("hr_executive can manage the whole workforce and reset demo data", () => {
    expect(can("hr_executive", "view_all_workforce")).toBe(true);
    expect(can("hr_executive", "manage_recruitment")).toBe(true);
    expect(can("hr_executive", "reset_demo")).toBe(true);
  });

  it("manager is scoped to team actions only", () => {
    expect(can("manager", "view_team")).toBe(true);
    expect(can("manager", "approve_recommendations")).toBe(true);
    expect(can("manager", "approve_onboarding")).toBe(true);
    expect(can("manager", "view_all_workforce")).toBe(false);
    expect(can("manager", "reset_demo")).toBe(false);
    expect(can("manager", "manage_recruitment")).toBe(false);
  });

  it("employee has self-service only", () => {
    expect(can("employee", "self_service")).toBe(true);
    expect(can("employee", "view_team")).toBe(false);
    expect(can("employee", "reset_demo")).toBe(false);
    expect(can("employee", "view_all_workforce")).toBe(false);
  });

  it("candidate has no elevated actions", () => {
    for (const action of ["view_all_workforce", "view_team", "reset_demo", "manage_recruitment"] as const) {
      expect(can("candidate", action)).toBe(false);
    }
  });

  it("labels are defined for all roles", () => {
    expect(ROLE_LABEL.hr_executive).toBe("HR Executive");
    expect(ROLE_LABEL.candidate).toBe("Candidate");
  });
});
