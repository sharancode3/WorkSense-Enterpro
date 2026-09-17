import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Briefcase, GitBranch, ListChecks, LogOut, RotateCcw, Settings, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { can, ROLE_BADGE_CLASS, ROLE_LABEL } from "@/lib/rbac";
import { resetDemo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, twin, signOut } = useAuth();
  const [resetting, setResetting] = useState(false);

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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b-2 border-border bg-background">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-extrabold text-white">
              W
            </span>
            <span className="text-lg font-bold tracking-tight text-foreground">WorkSense</span>
          </Link>

          <div className="flex items-center gap-2">
            {role && can(role, "manage_recruitment") && (
              <Link
                to="/recruitment"
                className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted md:flex"
              >
                <Briefcase className="h-4 w-4 text-secondary" />
                Recruitment
              </Link>
            )}
            {role && can(role, "view_onboarding") && (
              <Link
                to="/onboarding"
                className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted md:flex"
              >
                <ListChecks className="h-4 w-4 text-accent" />
                Onboarding
              </Link>
            )}
            {role && can(role, "explore_skill_graph") && (
              <Link
                to="/graph"
                className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted md:flex"
              >
                <GitBranch className="h-4 w-4 text-primary" />
                Skill Graph
              </Link>
            )}
            {role && (
              <span
                className={`hidden rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wider sm:inline-block ${ROLE_BADGE_CLASS[role]}`}
              >
                {ROLE_LABEL[role]}
              </span>
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
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-foreground text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-6 text-sm sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-secondary" />
            <span className="font-medium">Every recommendation is approved by a human before it moves.</span>
          </div>
          <span className="text-white/60">WorkSense — demo build</span>
        </div>
      </footer>
    </div>
  );
}
