// ---------------------------------------------------------------------------
// Phase 7 policy-context helpers — pure, testable:
//  - who may see whose employee context (server-side authorization)
//  - resolving an employee mention inside a question
// ---------------------------------------------------------------------------

export interface CallerView {
  id: string;
  role: string;
  org_id: string;
}

export interface EmployeeView {
  id: string;
  org_id: string;
  name: string;
  manager_id: string | null;
  work_location?: string | null;
  worker_type?: string | null;
}

/** Employees can see themselves; HR roles see everyone in the org; managers
 *  see their direct reports. Never decided on the client. */
export function canViewEmployee(caller: CallerView, target: EmployeeView): boolean {
  if (target.org_id !== caller.org_id) return false;
  if (target.id === caller.id) return true;
  if (["hr_executive", "hr_partner", "recruiter"].includes(caller.role)) return true;
  if (caller.role === "manager" && target.manager_id === caller.id) return true;
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find a visible employee whose first name appears as a whole word in the
 *  question. Deterministic; only returns employees the caller may view. */
export function findEmployeeMention(
  question: string,
  employees: EmployeeView[],
  caller: CallerView
): EmployeeView | null {
  const q = String(question ?? "").toLowerCase();
  for (const emp of employees) {
    if (!canViewEmployee(caller, emp)) continue;
    const first = (emp.name.split(/\s+/)[0] ?? "").toLowerCase();
    if (!first || first.length < 2) continue;
    const re = new RegExp(`(^|\\W)${escapeRegExp(first)}(\\W|$)`, "i");
    if (re.test(q)) return emp;
  }
  return null;
}
