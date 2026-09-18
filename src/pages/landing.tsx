import { Link } from "react-router-dom";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  CircleDot,
  ListChecks,
  ShieldCheck,
  Target,
} from "lucide-react";
import { DemoQuickAccess } from "@/components/demo-quick-access";
import { Button } from "@/components/ui/button";

// Representative product snapshot — the same shape a real recommendation card
// shows in the app: demand, evidence, recommended action, owner.
const PREVIEW = {
  role: "Senior Backend Engineer",
  evidence: [
    "Alex Chen · 78% current fit vs the approved role",
    "Skill path: Docker → Containerization → Kubernetes",
    "Rating: On Track · 80% of first-cycle goals met",
  ],
  action: "Expose Alex to Kubernetes work in the next sprint",
  owner: "People Manager approves",
};

const JOURNEYS = [
  {
    icon: Briefcase,
    title: "Hire with evidence",
    text: "Rank candidates by verified skill match, rubric scores, and interview evidence — then move a decision forward.",
  },
  {
    icon: ListChecks,
    title: "Unblock onboarding",
    text: "Plans are scheduled as a dependency graph with named owners. Report a blocker, resolve it, and re-approve — nothing happens out of order.",
  },
  {
    icon: Target,
    title: "Close a workforce skill gap",
    text: "See demand versus current skill coverage, then approve the least-cost path: hire, move, or upskill.",
  },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* Nav */}
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-base font-extrabold text-white">
              W
            </span>
            <span className="text-base font-bold tracking-tight text-foreground">
              Work<span className="text-primary">Sense</span>
            </span>
          </div>
          <Link to="/login">
            <Button variant="secondary" size="sm">
              Sign in
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero — short, mobile-safe headline + real product snapshot */}
      <section className="border-b border-border bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-2">
          <div>
            <span className="inline-block rounded-md bg-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Workforce decision intelligence
            </span>
            <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl xl:text-[2.75rem] xl:leading-[1.1]">
              Turn workforce evidence into{" "}
              <span className="text-primary">approved action plans</span>.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              WorkSense matches people to roles and plans with real records, then routes each
              recommendation through the human approval it needs.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#demo">
                <Button size="lg">
                  Explore guided demo <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
              <a href="#journeys">
                <Button variant="outline" size="lg">
                  Choose a role
                </Button>
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Fictional demonstration data — seeded personas, real role-based access control.
            </p>
          </div>

          {/* Product snapshot */}
          <div className="rounded-lg border border-border bg-white p-5 shadow-card sm:p-6" aria-label="Product preview">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Recommended action
              </span>
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Needs approval
              </span>
            </div>
            <p className="mt-3 text-lg font-extrabold leading-snug text-foreground">{PREVIEW.action}</p>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">{PREVIEW.role} · skill gap</p>

            <ul className="mt-4 flex flex-col gap-2">
              {PREVIEW.evidence.map((fact) => (
                <li key={fact} className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-secondary" strokeWidth={2} />
                  {fact}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CircleDot className="h-4 w-4 text-primary" />
                {PREVIEW.owner}
              </span>
              <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-primary">
                Review <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              Representative snapshot from the demo workspace — the app renders the same card from live records.
            </p>
          </div>
        </div>
      </section>

      {/* Three journeys */}
      <section id="journeys" className="scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 md:py-20">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Three journeys</span>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              Start where your work is.
            </h2>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {JOURNEYS.map(({ icon: Icon, title, text }) => (
              <Link
                key={title}
                to="/login"
                className="group flex flex-col gap-4 rounded-lg border border-border bg-white p-6 shadow-card transition-all duration-200 hover:border-primary hover:shadow-panel"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <div>
                  <h3 className="text-base font-extrabold text-foreground">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </div>
                <span className="mt-auto flex items-center gap-1.5 text-sm font-bold text-primary">
                  Explore <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Choose a role — demo access */}
      <section id="demo" className="scroll-mt-16 border-t border-border bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 md:py-20">
          <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Guided demo</span>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                Choose a role and walk the workflow.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Realistic fictional demo data, seeded for this preview. Each persona logs in with real
              credentials and row-level access — the enforcement is not hidden UI.
            </p>
          </div>

          <DemoQuickAccess />

          <p className="mt-8 flex items-start gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Every recommendation shown in the demo is approved by a human before it moves. All
            demonstration data is fictional.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-6 sm:px-6">
          <p className="text-sm font-medium text-foreground">
            Turn workforce evidence into approved action plans.
          </p>
          <p className="text-xs text-muted-foreground">
            Demonstration data is fictional and seeded for this preview.
          </p>
        </div>
      </footer>
    </div>
  );
}
