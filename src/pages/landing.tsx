import { Link } from "react-router-dom";
import { ArrowDown, GitBranch, ShieldCheck, Sparkles } from "lucide-react";
import { FlowDiagram } from "@/components/flow-diagram";
import { DemoAccessPanel } from "@/components/demo-access-panel";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <header className="border-b-2 border-border bg-background">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-extrabold text-white">
              W
            </span>
            <span className="text-lg font-bold tracking-tight text-foreground">WorkSense</span>
          </div>
          <Link to="/login">
            <Button variant="secondary" size="sm">
              Sign in
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-muted">
        {/* Flat decorative geometry — low opacity, no depth */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rotate-12 rounded-lg bg-secondary/10" />

        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <div className="max-w-3xl">
            <span className="inline-block rounded-md bg-foreground px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
              AI-driven workforce management
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground md:text-6xl">
              WorkSense turns fragmented HR data into{" "}
              <span className="text-primary">evidence-backed</span> workforce decisions.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Every decision moves through a human-approved workflow — from evidence to action,
              with a full audit trail.
            </p>
          </div>

          <div className="mt-14">
            <FlowDiagram />
          </div>

          <div className="mt-10 flex flex-wrap gap-4">
            <a href="#demo">
              <Button variant="hero" size="hero">
                Enter the demo <ArrowDown className="h-5 w-5" />
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Quick demo access */}
      <section id="demo" className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                Quick demo access
              </span>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
                One click. Three roles. Real data.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Each button signs into a pre-seeded persona. Role-based access is enforced at the
              data layer — not just hidden UI.
            </p>
          </div>

          <DemoAccessPanel />
        </div>
      </section>

      {/* Differentiator */}
      <section className="relative overflow-hidden bg-primary text-white">
        <div className="pointer-events-none absolute -right-20 top-1/2 h-64 w-64 -translate-y-1/2 rotate-12 rounded-lg bg-white/10" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-md bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" /> Not a chatbot
              </span>
              <h2 className="mt-6 text-3xl font-extrabold leading-tight tracking-tight md:text-4xl">
                One shared Skill Intelligence Graph reasons across recruitment, onboarding,
                performance, and workforce risk — and recommends actions a human then approves.
              </h2>
            </div>
            <div className="flex flex-col gap-4">
              {[
                {
                  icon: GitBranch,
                  title: "Reasoning, not chat",
                  text: "Skills, signals, and performance are matched deterministically against goals and roles — every claim is backed by an evidence ledger.",
                },
                {
                  icon: ShieldCheck,
                  title: "Human approval gate",
                  text: "No recommendation changes workflow state until the right role signs off. Decisions move needs_review → approved → dispatched.",
                },
                {
                  icon: Sparkles,
                  title: "Trusted AI, bounded scope",
                  text: "The model writes rationale, rubrics, and policy answers — the math (matching, scheduling, risk signals) never delegates to a model.",
                },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex gap-4 rounded-lg bg-white/10 p-5 transition-all duration-200 hover:scale-[1.02]">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-white text-primary">
                    <Icon className="h-6 w-6" strokeWidth={2.5} />
                  </span>
                  <div>
                    <h3 className="text-base font-bold">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-white/80">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-6 text-sm sm:flex-row sm:items-center sm:px-6">
          <span className="font-medium">WorkSense — Track 1 HR build</span>
          <span className="text-white/60">Evidence → Reasoning → Recommendation → Approval → Action</span>
        </div>
      </footer>
    </div>
  );
}
