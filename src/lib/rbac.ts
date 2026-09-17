export type Role =
  | "hr_executive"
  | "hr_partner"
  | "manager"
  | "recruiter"
  | "employee"
  | "candidate";

export type Action =
  | "view_all_workforce"
  | "explore_skill_graph"
  | "manage_recruitment"
  | "approve_recommendations"
  | "reset_demo"
  | "view_team"
  | "approve_onboarding"
  | "view_onboarding"
  | "self_service";

export const ROLES: Role[] = [
  "hr_executive",
  "hr_partner",
  "manager",
  "recruiter",
  "employee",
  "candidate",
];

/** Full display names (demo quick-access cards + app shell). */
export const ROLE_LABEL: Record<Role, string> = {
  hr_executive: "Administrator",
  hr_partner: "HR Business Partner",
  manager: "People Manager",
  recruiter: "Technical Recruiter",
  employee: "Employee",
  candidate: "Candidate",
};

/** Short badge text shown on quick-access cards (matches the reference UI). */
export const ROLE_BADGE_LABEL: Record<Role, string> = {
  hr_executive: "ADMIN",
  hr_partner: "HR",
  manager: "MANAGER",
  recruiter: "RECRUITER",
  employee: "EMPLOYEE",
  candidate: "CANDIDATE",
};

export const ROLE_BADGE_CLASS: Record<Role, string> = {
  hr_executive: "bg-primary text-white",
  hr_partner: "bg-primary text-white",
  manager: "bg-secondary text-white",
  recruiter: "bg-accent text-foreground",
  employee: "bg-accent text-foreground",
  candidate: "bg-muted text-foreground",
};

/**
 * Role -> landing route. Enforcement of these actions ALSO happens server-side
 * (RLS policies + backend functions); this map only drives client routing.
 */
export const ROLE_LANDING: Record<Role, string> = {
  hr_executive: "/app",
  hr_partner: "/app",
  manager: "/app",
  recruiter: "/app",
  employee: "/app",
  candidate: "/candidate-status",
};

export const ROLE_ACTIONS: Record<Role, Action[]> = {
  hr_executive: [
    "view_all_workforce",
    "explore_skill_graph",
    "manage_recruitment",
    "approve_recommendations",
    "reset_demo",
    "view_onboarding",
  ],
  hr_partner: ["view_all_workforce", "approve_recommendations", "view_onboarding"],
  manager: ["view_team", "approve_recommendations", "approve_onboarding", "view_onboarding"],
  recruiter: ["manage_recruitment"],
  employee: ["self_service", "view_onboarding"],
  candidate: [],
};

export function can(role: Role, action: Action): boolean {
  return ROLE_ACTIONS[role]?.includes(action) ?? false;
}

export function resolveLanding(role: Role): string {
  return ROLE_LANDING[role] ?? "/";
}
