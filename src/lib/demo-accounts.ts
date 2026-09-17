import type { Role } from "./rbac";

/**
 * Fixed demo personas — the one-click "Quick Demo Access" path. Real auth
 * accounts seeded in Enter Cloud by the reset-demo backend function. Zero
 * typing at demo time; every account logs in with a real JWT and RLS scoping.
 */
export const DEMO_PASSWORD = "WorkSenseDemo!2026";

export interface DemoAccount {
  role: Exclude<Role, "candidate">;
  email: string;
  password: string;
  name: string;
  badge: string;
  blurb: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: "hr_executive",
    email: "dana@worksense.demo",
    password: DEMO_PASSWORD,
    name: "Dana Whitmore",
    badge: "ADMIN",
    blurb: "See the whole workforce, approve recommended actions, run recruitment and policy.",
  },
  {
    role: "hr_partner",
    email: "riley@worksense.demo",
    password: DEMO_PASSWORD,
    name: "Riley Morgan",
    badge: "HR",
    blurb: "Own workforce data and policy — read everyone, approve recommendations.",
  },
  {
    role: "manager",
    email: "jordan@worksense.demo",
    password: DEMO_PASSWORD,
    name: "Jordan Reyes",
    badge: "MANAGER",
    blurb: "Track your team's risk and growth, approve onboarding and mobility moves.",
  },
  {
    role: "recruiter",
    email: "chris@worksense.demo",
    password: DEMO_PASSWORD,
    name: "Chris Okafor",
    badge: "RECRUITER",
    blurb: "Run the recruitment pipeline — rank candidates and move them through stages.",
  },
  {
    role: "employee",
    email: "alex@worksense.demo",
    password: DEMO_PASSWORD,
    name: "Alex Chen",
    badge: "EMPLOYEE",
    blurb: "Your tasks, your growth path, and instant answers to policy questions.",
  },
];

export const DEMO_CANDIDATE_CODE = "WS-PRIYA-2026";
export const CANDIDATE_CODES = ["WS-PRIYA-2026", "WS-DEV-2026", "WS-MAYA-2026"] as const;
