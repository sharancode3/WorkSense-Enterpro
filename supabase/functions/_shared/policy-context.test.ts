import { describe, expect, it } from "vitest";
import { canViewEmployee, employeeSelectorOptions, findEmployeeMention, type CallerView, type EmployeeView } from "./policy-context.ts";

const ORG = "org-1";
const employees: EmployeeView[] = [
  { id: "u1", org_id: ORG, name: "Samira Patel", manager_id: "m1", work_location: "US", worker_type: "full_time" },
  { id: "u2", org_id: ORG, name: "Alex Chen", manager_id: "m1", work_location: "US", worker_type: "full_time" },
  { id: "u3", org_id: ORG, name: "Maya Kapoor", manager_id: null, work_location: null, worker_type: null },
  { id: "org2", org_id: "org-2", name: "Isabelle Moreau", manager_id: null, work_location: null, worker_type: null },
];

describe("canViewEmployee (authorization)", () => {
  it("lets employees see themselves only", () => {
    const emp: CallerView = { id: "u1", role: "employee", org_id: ORG };
    expect(canViewEmployee(emp, employees[0])).toBe(true);
    expect(canViewEmployee(emp, employees[1])).toBe(false);
  });

  it("lets HR roles see everyone in the org", () => {
    const hr: CallerView = { id: "m1", role: "hr_partner", org_id: ORG };
    for (const e of employees) expect(canViewEmployee(hr, e)).toBe(e.org_id === ORG);
  });

  it("lets a manager see direct reports, not others", () => {
    const mgr: CallerView = { id: "m1", role: "manager", org_id: ORG };
    expect(canViewEmployee(mgr, employees[0])).toBe(true);
    expect(canViewEmployee(mgr, employees[2])).toBe(false);
  });

  it("never crosses organizations", () => {
    const hr: CallerView = { id: "m1", role: "hr_executive", org_id: ORG };
    expect(canViewEmployee(hr, employees[3])).toBe(false);
  });
});

describe("findEmployeeMention", () => {
  const caller: CallerView = { id: "m1", role: "hr_partner", org_id: ORG };

  it("resolves a first-name mention to the visible employee", () => {
    expect(findEmployeeMention("How much leave has Samira used this year?", employees, caller)?.id).toBe("u1");
  });

  it("does not match partial words", () => {
    expect(findEmployeeMention("Is the sampling methodology documented?", employees, caller)).toBeNull();
  });

  it("never resolves an employee the caller cannot see", () => {
    const emp: CallerView = { id: "u1", role: "employee", org_id: ORG };
    expect(findEmployeeMention("What is Alex's leave balance?", employees, emp)).toBeNull();
  });
});

describe("employeeSelectorOptions (Phase 9 item 18)", () => {
  it("excludes candidates and service users from the Employee selector", () => {
    const withRoles: EmployeeView[] = [
      { id: "e1", org_id: ORG, name: "Samira Patel", manager_id: "m1", role: "employee" },
      { id: "e2", org_id: ORG, name: "Alex Chen", manager_id: "m1", role: "manager" },
      { id: "c1", org_id: ORG, name: "Priya Rana", manager_id: null, role: "candidate" },
      { id: "s1", org_id: ORG, name: "Elena Voss", manager_id: "m1", role: "it_security" },
      { id: "self", org_id: ORG, name: "Dana Reyes", manager_id: null, role: "hr_executive" },
    ];
    const hr: CallerView = { id: "self", role: "hr_executive", org_id: ORG };
    const options = employeeSelectorOptions(withRoles, hr).map((e) => e.id);
    expect(options).toContain("e1");
    expect(options).toContain("e2");
    expect(options).not.toContain("c1"); // candidates never selectable
    expect(options).not.toContain("s1"); // service users never selectable
    expect(options).toContain("self"); // the caller themselves is allowed
  });
});
