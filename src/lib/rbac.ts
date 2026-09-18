export type Role =
  | "hr_executive"
  | "hr_partner"
  | "manager"
  | "recruiter"
  | "employee"
  | "candidate"
  | "it_security";

export type Action =
  | "view_all_workforce"
  | "explore_skill_graph"
  | "manage_recruitment"
  | "approve_recommendations"
  | "reset_demo"
  | "view_team"
  | "approve_onboarding"
  | "view_onboarding"
  | "use_policy_studio"
  | "manage_users"
  | "self_service";

export const ROLES: Role[] = [
  "hr_executive",
  "hr_partner",
  "manager",
  "recruiter",
  "employee",
  "candidate",
  "it_security",
];

/** Full display names (demo quick-access cards + app shell). */
export const ROLE_LABEL: Record<Role, string> = {
  hr_executive: "Administrator",
  hr_partner: "HR Business Partner",
  manager: "People Manager",
  recruiter: "Technical Recruiter",
  employee: "Employee",
  candidate: "Candidate",
  it_security: "IT Security",
};

/** Short badge text shown on quick-access cards (matches the reference UI). */
export const ROLE_BADGE_LABEL: Record<Role, string> = {
  hr_executive: "ADMIN",
  hr_partner: "HR",
  manager: "MANAGER",
  recruiter: "RECRUITER",
  employee: "EMPLOYEE",
  candidate: "CANDIDATE",
  it_security: "IT SEC",
};

// Neutral role badges — green/amber/red stay reserved for semantic states,
// never arbitrary role or category colors. Only the administrator role gets
// the brand blue; everyone else reads as ink/neutral.
export const ROLE_BADGE_CLASS: Record<Role, string> = {
  hr_executive: "bg-primary text-white",
  hr_partner: "bg-foreground text-white",
  manager: "bg-muted text-foreground",
  recruiter: "bg-muted text-foreground",
  employee: "bg-muted text-foreground",
  candidate: "bg-muted text-foreground",
  it_security: "bg-muted text-foreground",
};

/**
 * Role -> landing route. Enforcement of these actions ALSO happens server-side
 * (RLS policies + backend functions); this map only drives client routing.
 */
export const ROLE_LANDING: Record<Role, string> = {
  hr_executive: "/admin/access",
  hr_partner: "/app",
  manager: "/app",
  recruiter: "/app",
  employee: "/app",
  candidate: "/candidate-status",
  it_security: "/app",
};

export const ROLE_ACTIONS: Record<Role, Action[]> = {
  hr_executive: [
    "view_all_workforce",
    "explore_skill_graph",
    "manage_recruitment",
    "approve_recommendations",
    "reset_demo",
    "view_onboarding",
    "use_policy_studio",
    "manage_users",
  ],
  hr_partner: ["view_all_workforce", "explore_skill_graph", "approve_recommendations", "view_onboarding", "use_policy_studio"],
  manager: ["view_team", "explore_skill_graph", "approve_recommendations", "approve_onboarding", "view_onboarding", "use_policy_studio"],
  recruiter: ["manage_recruitment", "use_policy_studio", "explore_skill_graph"],
  employee: ["self_service", "view_onboarding", "use_policy_studio", "explore_skill_graph"],
  candidate: [],
  it_security: ["view_onboarding"],
};

export function can(role: Role, action: Action): boolean {
  return ROLE_ACTIONS[role]?.includes(action) ?? false;
}

export function resolveLanding(role: Role): string {
  return ROLE_LANDING[role] ?? "/";
}
