import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ChevronDown, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { DEMO_ACCOUNTS, DEMO_CANDIDATE_CODE } from "@/lib/demo-accounts";
import { ROLE_LABEL, resolveLanding, type Role } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BADGE: Record<string, string> = {
  hr_executive: "ADMIN",
  hr_partner: "HR",
  manager: "MANAGER",
  recruiter: "RECRUITER",
  employee: "EMPLOYEE",
  candidate: "CANDIDATE",
  it_security: "IT SEC",
};

export default function Login() {
  const { signInWithEmail, signInDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<"form" | string | null>(null);
  const [demoOpen, setDemoOpen] = useState(true);

  const from = (location.state as { from?: string } | null)?.from ?? "/app";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy("form");
    try {
      await signInWithEmail(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(null);
    }
  };

  const enterDemo = async (role: Exclude<Role, "candidate">) => {
    setBusy(role);
    try {
      await signInDemo(role);
      navigate(resolveLanding(role), { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Demo login failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      {/* Top nav */}
      <header className="h-14 border-b border-border bg-white">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-base font-extrabold text-white">
              W
            </span>
            <span className="text-base font-bold tracking-tight">
              <span className="text-foreground">Work</span>
              <span className="text-primary">Sense</span>
            </span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Platform Overview
          </Link>
        </div>
      </header>

      {/* Centered card */}
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[520px] animate-fade-up rounded-lg border border-border bg-white p-8 sm:p-10">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheck className="h-6 w-6 text-primary" strokeWidth={2} />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight">
              <span className="text-foreground">Sign in to Work</span>
              <span className="text-primary">Sense</span>
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Turn workforce evidence into approved action plans.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">
                Work Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.com"
                autoComplete="email"
                className="h-12"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </Label>
                <span className="cursor-pointer text-sm font-medium text-primary transition-opacity hover:opacity-80">
                  Forgot password?
                </span>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  className="h-12 pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <Button type="submit" size="xl" disabled={busy === "form"} className="w-full">
              {busy === "form" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="h-5 w-5" strokeWidth={2.5} />
                </>
              )}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Applied for an open role?{" "}
            <Link to={`/candidate-status?code=${DEMO_CANDIDATE_CODE}`} className="font-semibold text-primary transition-opacity hover:opacity-80">
              Check your application status
            </Link>
          </p>

          {/* Demo Environment Quick Access */}
          <div className="mt-8 overflow-hidden rounded-lg border border-border bg-white">
            <button
              type="button"
              onClick={() => setDemoOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <KeyRound className="h-4 w-4 text-primary" strokeWidth={2} />
                Demo Environment Quick Access
              </span>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${demoOpen ? "" : "-rotate-90"}`}
              />
            </button>

            {demoOpen && (
              <div className="animate-fade-in border-t border-border px-4 pb-4 pt-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Realistic fictional demo data — personas log in with real credentials and row-level access.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DEMO_ACCOUNTS.map((account, i) => (
                    <button
                      key={account.role}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void enterDemo(account.role)}
                      style={{ animationDelay: `${i * 60}ms` }}
                      className="group flex animate-fade-up items-start justify-between gap-2 rounded-md bg-muted px-3 py-2.5 text-left transition-all duration-200 hover:scale-[1.02] hover:bg-border disabled:cursor-wait disabled:opacity-70"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-semibold leading-tight text-foreground">{ROLE_LABEL[account.role]}</span>
                        <span className="mt-0.5 font-mono text-[11px] leading-tight text-muted-foreground">
                          {busy === account.role ? "Signing in…" : account.email}
                        </span>
                      </span>
                      {busy === account.role ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      ) : (
                        <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {BADGE[account.role]}
                        </span>
                      )}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => navigate(`/candidate-status?code=${DEMO_CANDIDATE_CODE}`)}
                    className="group flex animate-fade-up items-start justify-between gap-2 rounded-md bg-muted px-3 py-2.5 text-left transition-all duration-200 hover:scale-[1.02] hover:bg-border"
                    style={{ animationDelay: "360ms" }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold leading-tight text-foreground">Candidate</span>
                      <span className="mt-0.5 font-mono text-[11px] leading-tight text-muted-foreground">no login needed</span>
                    </span>
                    <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      CANDIDATE
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
