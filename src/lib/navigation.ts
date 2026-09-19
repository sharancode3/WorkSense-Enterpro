// Phase 2: role-aware information architecture for the application shell.
//
// Top-level sections: My work · People · Hiring · Workforce planning ·
// Policies · Administration. Every item is gated by the same server-enforced
// actions as the page it opens (see rbac.ts) — a section with no visible items
// is hidden entirely. Deep links stay unchanged; this model only organizes them.

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Briefcase,
  Compass,
  Database,
  Gauge,
  GitBranch,
  Layers,
  LayoutGrid,
  ListChecks,
  ScrollText,
  ShieldCheck,
  Sun,
  TrendingUp,
  UserCog,
  Users,
} from "lucide-react";
import { can, type Role } from "./rbac";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Must match the server-enforced action of the destination page. */
  show: (role: Role) => boolean;
  /** Optional badge source key (the app shell fills counts from My Day). */
  badgeKey?: string;
}

export interface NavSection {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Breadcrumb/section name for nested pages. */
  crumbLabel: string;
  items: NavItem[];
}

const ITEMS: NavItem[] = [
  // Overview is the landing for every staff role; candidates have their own
  // status workspace and never render this app shell.
  { label: "Overview", to: "/app", icon: Gauge, show: (r) => r !== "candidate" },
  // Phase 33: "My Day" — personal + role work orchestration. Visible to every
  // staff role; candidates stay in the candidate portal (their next steps are
  // simplified and never internal).
  { label: "My Day", to: "/my-day", icon: Sun, show: (r) => r !== "candidate", badgeKey: "my-day" },
  { label: "Onboarding", to: "/onboarding", icon: ListChecks, show: (r) => can(r, "view_onboarding") },
  { label: "Recommendation hub", to: "/hub", icon: Layers, show: (r) => can(r, "approve_recommendations") },
  { label: "Workforce review", to: "/workforce", icon: Users, show: (r) => can(r, "view_all_workforce") || can(r, "view_team") || r === "employee" },
  { label: "Skill graph", to: "/graph", icon: GitBranch, show: (r) => can(r, "explore_skill_graph") },
  { label: "Recruitment", to: "/recruitment", icon: Briefcase, show: (r) => can(r, "manage_recruitment") },
  { label: "Staffing planner", to: "/staffing", icon: TrendingUp, show: (r) => can(r, "view_all_workforce") || can(r, "view_team") },
  { label: "Policy studio", to: "/policy", icon: ScrollText, show: (r) => can(r, "use_policy_studio") },
  { label: "Access & users", to: "/admin/access", icon: UserCog, show: (r) => can(r, "manage_users") },
  { label: "System health", to: "/status", icon: Activity, show: (r) => can(r, "manage_users") },
  { label: "Data quality", to: "/workforce/data-quality", icon: Database, show: (r) => can(r, "manage_users") },
];

const byTo = new Map(ITEMS.map((i) => [i.to, i]));

export const NAV_SECTIONS: NavSection[] = [
  {
    key: "my-work",
    label: "My work",
    icon: LayoutGrid,
    crumbLabel: "My work",
    items: ["/app", "/my-day", "/onboarding", "/hub"].map((to) => byTo.get(to)!),
  },
  {
    key: "people",
    label: "People",
    icon: Users,
    crumbLabel: "People",
    items: ["/workforce", "/graph"].map((to) => byTo.get(to)!),
  },
  {
    key: "hiring",
    label: "Hiring",
    icon: Briefcase,
    crumbLabel: "Hiring",
    items: ["/recruitment"].map((to) => byTo.get(to)!),
  },
  {
    key: "planning",
    label: "Workforce planning",
    icon: Compass,
    crumbLabel: "Workforce planning",
    items: ["/staffing"].map((to) => byTo.get(to)!),
  },
  {
    key: "policies",
    label: "Policies",
    icon: ScrollText,
    crumbLabel: "Policies",
    items: ["/policy"].map((to) => byTo.get(to)!),
  },
  {
    key: "admin",
    label: "Administration",
    icon: ShieldCheck,
    crumbLabel: "Administration",
    items: ["/admin/access", "/status", "/workforce/data-quality"].map((to) => byTo.get(to)!),
  },
];

/**
 * Sections filtered to the items this role may actually open. Each item's
 * permission is evaluated individually (a section is not revealed by one
 * visible sibling), empty sections are dropped, and the original navigation
 * configuration is never mutated. The same model drives the expanded sidebar,
 * the minimized rail and the mobile drawer.
 */
export function visibleSections(role: Role): NavSection[] {
  const out: NavSection[] = [];
  for (const s of NAV_SECTIONS) {
    const items = s.items.filter((i) => i.show(role));
    if (items.length === 0) continue;
    out.push({ ...s, items });
  }
  return out;
}

/**
 * Breadcrumb trail for the current path. Nested/grouped pages get
 * [Section label, Page label]; flat pages return just the page label.
 */
export function breadcrumbFor(pathname: string): { crumb: string; label: string } | null {
  if (pathname === "/workforce/data-quality") {
    return { crumb: "Administration", label: "Data quality" };
  }
  if (pathname === "/admin/access") {
    return { crumb: "Administration", label: "Access & users" };
  }
  if (pathname === "/status") {
    return { crumb: "Administration", label: "System health" };
  }
  const item = ITEMS.find((i) => i.to === pathname);
  if (!item) return null;
  const section = NAV_SECTIONS.find((s) => s.items.some((i) => i.to === pathname));
  return { crumb: section?.crumbLabel ?? "WorkSense", label: item.label };
}
