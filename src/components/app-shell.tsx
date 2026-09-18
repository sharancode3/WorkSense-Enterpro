import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Briefcase,
  Database,
  GitBranch,
  Layers,
  ListChecks,
  LogOut,
  Menu,
  MessageSquareText,
  RotateCcw,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { can, ROLE_BADGE_CLASS, ROLE_LABEL, type Role } from "@/lib/rbac";
import { fetchHealth, resetDemo } from "@/lib/api";
import { BUILD_INFO } from "@/generated/build-info";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function HealthChip({
  gateway,
  modelReady,
  authOk,
  checking,
}: {
  gateway?: "reachable" | "unreachable";
  modelReady?: boolean;
  authOk?: boolean;
  checking: boolean;
}) {
  let label = "AI gateway: checking…";
  let cls = "bg-white/10 text-white/70";
  if (!checking && gateway === "reachable" && modelReady) {
    label = authOk ? "AI ready · authenticated" : "AI ready · tunnel not gateway-authenticated";
    cls = authOk ? "bg-secondary text-white" : "bg-accent text-foreground";
  } else if (!checking && gateway === "reachable" && !modelReady) {
    label = "AI gateway up · model unavailable";
    cls = "bg-accent text-foreground";
  } else if (!checking) {
    label = "AI gateway unreachable";
    cls = "bg-destructive text-white";
  }
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>{label}</span>;
}

// ---- Phase 27: role-scoped navigation --------------------------------------
// One flat row of icon-backed tabs, each gated by the same server-enforced
// actions as the page it opens. No locked placeholders, no category labels.
interface NavLinkDef {
  label: string;
  to: string;
  icon: typeof Users;
  show: (role: Role) => boolean;
}

const NAV_LINKS: NavLinkDef[] = [
  { label: "Overview", to: "/app", icon: ShieldCheck, show: () => true },
  { label: "Recruitment", to: "/recruitment", icon: Briefcase, show: (role) => can(role, "manage_recruitment") },
  { label: "Workforce review", to: "/workforce", icon: Users, show: (role) => can(role, "view_all_workforce") || can(role, "view_team") || role === "employee" },
  { label: "Staffing planner", to: "/staffing", icon: TrendingUp, show: (role) => can(role, "view_all_workforce") || can(role, "view_team") },
  { label: "Onboarding", to: "/onboarding", icon: ListChecks, show: (role) => can(role, "view_onboarding") },
  { label: "Recommendation hub", to: "/hub", icon: Layers, show: (role) => can(role, "approve_recommendations") },
  { label: "Skill graph", to: "/graph", icon: GitBranch, show: (role) => can(role, "explore_skill_graph") },
  { label: "Policy studio", to: "/policy", icon: MessageSquareText, show: (role) => can(role, "use_policy_studio") },
  { label: "Access & users", to: "/admin/access", icon: UserCog, show: (role) => can(role, "manage_users") },
  { label: "System health", to: "/status", icon: Activity, show: (role) => can(role, "manage_users") },
  { label: "Data quality", to: "/workforce/data-quality", icon: Database, show: (role) => can(role, "manage_users") },
];

function visibleLinks(role: Role): NavLinkDef[] {
  return NAV_LINKS.filter((l) => l.show(role));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, twin, signOut, user } = useAuth();
  const [resetting, setResetting] = useState(false);
  const location = useLocation();

  // Limited AI-gateway health indicator (4 states): app backend ok (implicit),
  // gateway reachable, model ready, generation failed is surfaced per job.
  const health = useQuery({
    queryKey: ["ai-health", user?.id ?? "anon"],
    queryFn: fetchHealth,
    refetchInterval: 60_000,
    enabled: !!user,
    retry: false,
  });

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetDemo();
      toast.success("Demo data restored to the known-good state.");
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const links = role ? visibleLinks(role) : [];
  const aiState = health.data
    ? health.data.model_ready
      ? "AI gateway: ready"
      : "AI gateway: model unavailable"
    : health.isError
      ? "AI gateway: unreachable"
      : "AI gateway: checking…";

  const renderLink = (l: NavLinkDef, mobile = false) => {
    const active = location.pathname === l.to;
    return (
      <Link
        key={l.to}
        to={l.to}
        className={
          mobile
            ? "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            : `flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                active ? "bg-muted text-foreground" : "text-foreground/80 hover:bg-muted hover:text-foreground"
              }`
        }
        aria-current={active ? "page" : undefined}
      >
        <l.icon className="h-4 w-4 text-primary" />
        {l.label}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Phase 14: unmistakable demo-mode indicator + live build/health */}
      <div className="border-b border-border bg-foreground text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-[11px] font-semibold sm:px-6">
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-destructive px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white">Demo mode</span>
            All data is fictional · seeded for this demonstration
          </span>
          <span className="flex items-center gap-1.5 text-white/70">
            <span className={`h-1.5 w-1.5 rounded-full ${health.data?.model_ready ? "bg-secondary" : health.isError ? "bg-destructive" : "bg-muted"}`} />
            {aiState}
          </span>
          <span className="ml-auto hidden text-white/50 sm:inline">build {BUILD_INFO.commit.slice(0, 7)} · schema {BUILD_INFO.schemaVersion}</span>
        </div>
      </div>

      <header className="border-b-2 border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-extrabold text-white">
                W
              </span>
              <span className="text-lg font-bold tracking-tight text-foreground">WorkSense</span>
            </Link>

            <div className="flex items-center gap-2">
              {role && (
                <span
                  className={`hidden rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wider sm:inline-block ${ROLE_BADGE_CLASS[role]}`}
                >
                  {ROLE_LABEL[role]}
                </span>
              )}
              {/* Mobile navigation */}
              {links.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" className="md:hidden" aria-label="Open navigation menu">
                      <Menu className="h-4 w-4" />
                      <span className="sr-only">Menu</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 max-h-[70vh] overflow-y-auto">
                    <DropdownMenuLabel>Navigate</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="flex flex-col px-2 pb-2 pt-1">
                      {links.map((l) => renderLink(l, true))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    <Settings className="h-4 w-4" />
                    <span className="hidden sm:inline">{twin?.name ?? "Account"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    {twin?.name}
                    <p className="text-xs font-normal text-muted-foreground">{twin?.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {role && can(role, "reset_demo") && (
                    <>
                      <DropdownMenuItem
                        disabled={resetting}
                        onSelect={(e) => {
                          e.preventDefault();
                          void handleReset();
                        }}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Reset Demo Data
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      void signOut();
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Role-scoped desktop nav — one flat row of icon-backed tabs */}
          {links.length > 0 && (
            <nav
              aria-label="Primary"
              className="hidden flex-wrap items-center gap-x-1 gap-y-1 overflow-x-auto border-t border-border py-2 md:flex"
            >
              {links.map((l) => renderLink(l))}
            </nav>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-foreground text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm sm:px-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-secondary" />
              <span className="font-medium">Every recommendation is approved by a human before it moves.</span>
            </div>
            <p className="text-white/60">
              Skill matching, onboarding scheduling, and risk scoring are deterministic — AI is used
              only to extract, explain, and generate language, never to decide.
            </p>
          </div>
          <span className="text-xs text-white/40">
            Demonstration data is fictional. build {BUILD_INFO.commit} · {new Date(BUILD_INFO.builtAt).toLocaleString()} · schema {BUILD_INFO.schemaVersion}
          </span>
          <HealthChip
            gateway={health.data?.gateway}
            modelReady={health.data?.model_ready}
            authOk={health.data?.gateway_authenticated}
            checking={health.isLoading}
          />
        </div>
      </footer>
    </div>
  );
}
