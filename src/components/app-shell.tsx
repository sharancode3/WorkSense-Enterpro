import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Menu, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { can, ROLE_BADGE_CLASS, ROLE_LABEL, type Role } from "@/lib/rbac";
import { breadcrumbFor, type NavSection, visibleSections } from "@/lib/navigation";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Active link style — blue tint + ink text, with an explicit focus ring. */
function linkClass(active: boolean): string {
  return active
    ? "bg-primary/10 text-primary"
    : "text-foreground/75 hover:bg-muted hover:text-foreground";
}

/** Renders one section's nav items (shared by sidebar and mobile drawer). */
function SectionList({
  section,
  pathname,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex items-center gap-1.5 px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
        <section.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {section.label}
      </p>
      <nav aria-label={section.label} className="flex flex-col gap-0.5">
        {section.items.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${linkClass(active)}`}
            >
              <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/app" className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-base font-extrabold text-white">
        W
      </span>
      {!compact && (
        <span className="text-base font-bold tracking-tight text-foreground">
          Work<span className="text-primary">Sense</span>
        </span>
      )}
    </Link>
  );
}

function AccountFooter() {
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
    <div className="flex flex-col gap-2.5 border-t border-border px-4 py-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-extrabold text-foreground">
          {twin?.name?.charAt(0) ?? "?"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{twin?.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{twin?.email}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {role && can(role, "reset_demo") && (
          <Button size="sm" variant="secondary" onClick={() => void handleReset()} disabled={resetting} className="flex-1">
            <RotateCcw className="h-3.5 w-3.5" /> Reset demo
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void signOut()} className="flex-1">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, twin, user, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  const health = useQuery({
    queryKey: ["ai-health", user?.id ?? "anon"],
    queryFn: fetchHealth,
    refetchInterval: 60_000,
    enabled: !!user,
    retry: false,
  });

  const healthDot = health.data
    ? health.data.model_ready
      ? "bg-secondary"
      : "bg-accent"
    : health.isError
      ? "bg-destructive"
      : "bg-muted";
  const healthLabel = health.data
    ? health.data.model_ready
      ? "AI gateway ready"
      : "AI gateway up, model unavailable"
    : health.isError
      ? "AI gateway unreachable"
      : "Checking AI gateway…";

  const sections = role ? visibleSections(role) : [];
  const breadcrumb = breadcrumbFor(location.pathname);
  const showBreadcrumb = breadcrumb && breadcrumb.crumb !== breadcrumb.label;

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Desktop sidebar — independently scrollable, account controls pinned. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-white md:flex">
        <div className="flex h-14 items-center px-5">
          <Brand />
        </div>
        {role && (
          <div className="px-5 pb-2">
            <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${ROLE_BADGE_CLASS[role]}`}>
              {ROLE_LABEL[role]}
            </span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((s) => (
            <SectionList key={s.key} section={s} pathname={location.pathname} />
          ))}
        </div>
        <AccountFooter />
      </aside>

      {/* Content column */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Top bar — concise demo indicator; diagnostics live in the account menu + status page. */}
        <header className="sticky top-0 z-30 border-b border-border bg-white">
          <div className="flex h-12 items-center gap-3 px-4 sm:px-6">
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button variant="secondary" size="sm" className="md:hidden" aria-label="Open navigation menu">
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0 sm:max-w-sm">
                <SheetHeader className="h-14 justify-center border-b border-border px-5 text-left">
                  <SheetTitle className="sr-only">WorkSense navigation</SheetTitle>
                  <Brand />
                </SheetHeader>
                {role && (
                  <div className="border-b border-border px-5 py-2">
                    <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${ROLE_BADGE_CLASS[role]}`}>
                      {ROLE_LABEL[role]}
                    </span>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-3 pb-4">
                  {sections.map((s) => (
                    <SectionList
                      key={s.key}
                      section={s}
                      pathname={location.pathname}
                      onNavigate={() => setDrawerOpen(false)}
                    />
                  ))}
                </div>
                <AccountFooter />
              </SheetContent>
            </Sheet>

            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
              Demo
              <span className="hidden sm:inline">· fictional data</span>
            </span>
            {role && <span className="hidden text-xs font-semibold text-muted-foreground md:inline">{ROLE_LABEL[role]}</span>}

            <div className="ml-auto flex items-center gap-2">
              <span
                title={healthLabel}
                aria-label={healthLabel}
                className={`h-2 w-2 rounded-full ${healthDot}`}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    <span className="hidden sm:inline">{twin?.name?.split(" ")[0] ?? "Account"}</span>
                    <span className="sm:hidden">Account</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>
                    {twin?.name}
                    <p className="truncate text-xs font-normal text-muted-foreground">{twin?.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* Diagnostics: gateway state + build identity — out of the page UI. */}
                  <div className="px-2 py-2">
                    <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Diagnostics</p>
                    <p className="px-2 pt-1 text-xs text-muted-foreground">
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${healthDot}`} />
                      {healthLabel}
                    </p>
                    <p className="px-2 pt-1 font-mono text-[11px] text-muted-foreground">
                      build {BUILD_INFO.commit.slice(0, 7)} · schema {BUILD_INFO.schemaVersion}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  {role && can(role, "reset_demo") && (
                    <>
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          void resetDemo().then(() => {
                            toast.success("Demo data restored to the known-good state.");
                            window.location.href = "/";
                          }).catch((err: Error) => toast.error(err.message ?? "Reset failed"));
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

        {/* Breadcrumb for nested/grouped pages. */}
        {showBreadcrumb && breadcrumb && (
          <nav aria-label="Breadcrumb" className="border-b border-border bg-white">
            <ol className="mx-auto flex max-w-7xl items-center gap-1.5 px-4 py-2 text-xs sm:px-6">
              <li>
                <Link to="/app" className="font-semibold text-muted-foreground hover:text-foreground">
                  WorkSense
                </Link>
              </li>
              <li aria-hidden="true" className="text-muted-foreground/50">/</li>
              <li>
                <span className="font-semibold text-muted-foreground">{breadcrumb.crumb}</span>
              </li>
              <li aria-hidden="true" className="text-muted-foreground/50">/</li>
              <li aria-current="page" className="font-bold text-foreground">
                {breadcrumb.label}
              </li>
            </ol>
          </nav>
        )}

        <main className="flex-1">{children}</main>

        <footer className="border-t border-border bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-5 sm:px-6">
            <p className="text-sm font-medium text-foreground">
              Every recommendation is approved by a human before it moves.
            </p>
            <p className="text-xs text-muted-foreground">
              Demonstration data is fictional and seeded for this preview.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
