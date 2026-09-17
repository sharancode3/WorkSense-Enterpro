import type { Role } from "./rbac";

/**
 * Fixed demo personas — the "Quick Demo Access" path. Real auth accounts seeded
 * in Enter Cloud by the reset-demo backend function. Zero typing at demo time.
 */
export const DEMO_PASSWORD = "WorkSenseDemo!2026";

export interface DemoAccount {
  role: Exclude<Role, "candidate">;
  email: string;
  password: string;
  name: string;
  blurb: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: "hr_executive",
    email: "dana@worksense.demo",
    password: DEMO_PASSWORD,
    name: "Dana Whitmore",
    blurb: "See the whole workforce, approve recommended actions, run recruitment and policy.",
  },
  {
    role: "manager",
    email: "jordan@worksense.demo",
    password: DEMO_PASSWORD,
    name: "Jordan Reyes",
    blurb: "Track your team's risk and growth, approve onboarding and mobility moves.",
  },
  {
    role: "employee",
    email: "alex@worksense.demo",
    password: DEMO_PASSWORD,
    name: "Alex Chen",
    blurb: "Your tasks, your growth path, and instant answers to policy questions.",
  },
];

export const DEMO_CANDIDATE_CODE = "WS-PRIYA-2026";
export const CANDIDATE_CODES = ["WS-PRIYA-2026", "WS-DEV-2026", "WS-MAYA-2026"] as const;
