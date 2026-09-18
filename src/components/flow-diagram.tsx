import { ArrowDown, ArrowRight, Brain, FileSearch, Lightbulb, Rocket, ShieldCheck } from "lucide-react";

interface Step {
  label: string;
  sub: string;
  icon: typeof FileSearch;
  className: string;
}

const STEPS: Step[] = [
  {
    label: "Evidence",
    sub: "skills, signals, records",
    icon: FileSearch,
    className: "bg-muted text-foreground",
  },
  {
    label: "Reasoning",
    sub: "Skill Graph + signals",
    icon: Brain,
    className: "bg-primary text-white",
  },
  {
    label: "Recommendation",
    sub: "with evidence ledger",
    icon: Lightbulb,
    className: "bg-secondary text-white",
  },
  {
    label: "Approval",
    sub: "by a human",
    icon: ShieldCheck,
    className: "bg-accent text-foreground",
  },
  {
    label: "Action",
    sub: "audit-logged",
    icon: Rocket,
    className: "bg-foreground text-white",
  },
];

export function FlowDiagram() {
  return (
    <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-0">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        return (
          <div key={step.label} className="flex items-center">
            <div
              className={`flex flex-1 flex-col items-start gap-1 rounded-lg px-5 py-4 transition-all duration-200 hover:scale-[1.03] md:flex-1 ${step.className}`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-extrabold uppercase tracking-wider">{step.label}</span>
                <Icon className="h-5 w-5 opacity-80" strokeWidth={2.5} />
              </div>
              <span className={`text-xs ${i === 0 || i === 3 ? "text-muted-foreground" : "text-white/75"}`}>
                {step.sub}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <>
                <span className="hidden px-1 text-foreground md:inline-block">
                  <ArrowRight className="h-5 w-5" strokeWidth={2.5} />
                </span>
                <span className="py-1 text-foreground md:hidden">
                  <ArrowDown className="h-5 w-5" strokeWidth={2.5} />
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
