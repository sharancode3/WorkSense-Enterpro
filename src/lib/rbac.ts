export type Role = "hr_executive" | "manager" | "employee" | "candidate";

export type Action =
  | "view_all_workforce"
  | "manage_recruitment"
  | "approve_recommendations"
  | "reset_demo"
  | "view_team"
  | "approve_onboarding"
  | "self_service";

export const ROLES: Role[] = ["hr_executive", "manager", "employee", "candidate"];

export const ROLE_LABEL: Record<Role, string> = {
  hr_executive: "HR Executive",
  manager: "Manager",
  employee: "Employee",
  candidate: "Candidate",
};

export const ROLE_BADGE_CLASS: Record<Role, string> = {
  hr_executive: "bg-primary text-white",
  manager: "bg-secondary text-white",
  employee: "bg-accent text-foreground",
  candidate: "bg-muted text-foreground",
};

/**
 * Role -> landing route. Enforcement of these actions ALSO happens server-side
 * (RLS policies + backend functions); this map only drives client routing.
 */
export const ROLE_LANDING: Record<Role, string> = {
  hr_executive: "/app",
  manager: "/app",
  employee: "/app",
  candidate: "/candidate-status",
};

export const ROLE_ACTIONS: Record<Role, Action[]> = {
  hr_executive: [
    "view_all_workforce",
    "manage_recruitment",
    "approve_recommendations",
    "reset_demo",
  ],
  manager: ["view_team", "approve_recommendations", "approve_onboarding"],
  employee: ["self_service"],
  candidate: [],
};

export function can(role: Role, action: Action): boolean {
  return ROLE_ACTIONS[role]?.includes(action) ?? false;
}

export function resolveLanding(role: Role): string {
  return ROLE_LANDING[role] ?? "/";
}
