import { describe, expect, it } from "vitest";
import { can, resolveLanding, ROLE_LABEL, ROLES, type Role } from "@/lib/rbac";

describe("rbac", () => {
  it("maps every role to a landing route", () => {
    for (const role of ROLES) {
      expect(resolveLanding(role)).toMatch(/^\//);
    }
  });

  it("hr_executive (Administrator) can manage everything including reset and the graph", () => {
    expect(can("hr_executive", "view_all_workforce")).toBe(true);
    expect(can("hr_executive", "explore_skill_graph")).toBe(true);
    expect(can("hr_executive", "manage_recruitment")).toBe(true);
    expect(can("hr_executive", "reset_demo")).toBe(true);
  });

  it("hr_partner (HR Business Partner) sees the workforce but cannot reset or explore the graph", () => {
    expect(can("hr_partner", "view_all_workforce")).toBe(true);
    expect(can("hr_partner", "approve_recommendations")).toBe(true);
    expect(can("hr_partner", "reset_demo")).toBe(false);
    expect(can("hr_partner", "explore_skill_graph")).toBe(false);
    expect(can("hr_partner", "manage_recruitment")).toBe(false);
  });

  it("manager (People Manager) is scoped to team actions only", () => {
    expect(can("manager", "view_team")).toBe(true);
    expect(can("manager", "approve_recommendations")).toBe(true);
    expect(can("manager", "approve_onboarding")).toBe(true);
    expect(can("manager", "view_all_workforce")).toBe(false);
    expect(can("manager", "reset_demo")).toBe(false);
    expect(can("manager", "manage_recruitment")).toBe(false);
  });

  it("recruiter (Technical Recruiter) has recruitment + skill-graph + policy access", () => {
    expect(can("recruiter", "manage_recruitment")).toBe(true);
    expect(can("recruiter", "view_all_workforce")).toBe(false);
    expect(can("recruiter", "view_team")).toBe(false);
    expect(can("recruiter", "approve_recommendations")).toBe(false);
    expect(can("recruiter", "reset_demo")).toBe(false);
    // Phase 27: recruiters get the Skill Graph (candidate matching) + policy assistant.
    expect(can("recruiter", "explore_skill_graph")).toBe(true);
    expect(can("recruiter", "use_policy_studio")).toBe(true);
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

  it("labels match the demo quick-access roles", () => {
    expect(ROLE_LABEL.hr_executive).toBe("Administrator");
    expect(ROLE_LABEL.hr_partner).toBe("HR Business Partner");
    expect(ROLE_LABEL.manager).toBe("People Manager");
    expect(ROLE_LABEL.recruiter).toBe("Technical Recruiter");
    expect(ROLE_LABEL.employee).toBe("Employee");
    expect(ROLE_LABEL.candidate).toBe("Candidate");
    expect(ROLE_LABEL.it_security).toBe("IT Security");
  });

  it("it_security sees onboarding but no HR/recruitment powers", () => {
    expect(can("it_security", "view_onboarding")).toBe(true);
    expect(can("it_security", "view_all_workforce")).toBe(false);
    expect(can("it_security", "manage_recruitment")).toBe(false);
    expect(can("it_security", "approve_recommendations")).toBe(false);
    expect(can("it_security", "reset_demo")).toBe(false);
    expect(resolveLanding("it_security")).toBe("/app");
  });

  it("role union is stable", () => {
    const roles: Role[] = ["hr_executive", "hr_partner", "manager", "recruiter", "employee", "candidate", "it_security"];
    expect(roles).toEqual(ROLES);
  });
});
