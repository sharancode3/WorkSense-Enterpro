import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { can } from "@/lib/rbac";
import {
  explainStaffingScenario,
  planStaffing,
  proposeStaffingScenario,
  type PlannerOption,
  type StaffingPlanInput,
  type StaffingPlanResult,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Lock,
  MessageSquareText,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  feasible: { label: "Feasible", cls: "bg-secondary text-white" },
  conditional: { label: "Conditional", cls: "bg-accent text-foreground" },
  infeasible: { label: "Infeasible", cls: "bg-destructive text-white" },
  insufficient_data: { label: "Insufficient data", cls: "bg-muted text-foreground" },
};

const COVERAGE_META: Record<string, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "bg-secondary text-white" },
  conditional: { label: "Conditional", cls: "bg-accent text-foreground" },
  gap: { label: "Gap", cls: "bg-destructive/20 text-destructive" },
  absent: { label: "Absent", cls: "bg-muted text-foreground" },
};

interface SkillRow {
  skill: string;
  min_proficiency: string;
  mandatory: boolean;
}

export default function StaffingPlanner() {
  const { role, twin: me } = useAuth();
  const [scenario, setScenario] = useState<StaffingPlanInput>({
    name: "Backend team in 6 weeks",
    demand_title: "Senior Backend Engineer",
    deadline_days: 42,
    budget_usd: 60000,
    capacity_people: 1,
    geography: "US",
    horizon_months: 12,
  });
  const [skills, setSkills] = useState<SkillRow[]>([
    { skill: "Go", min_proficiency: "3", mandatory: true },
    { skill: "REST APIs", min_proficiency: "3", mandatory: true },
  ]);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<StaffingPlanResult | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposalId, setProposalId] = useState<string | null>(null);

  const run = useCallback(async (recalc = false) => {
    const required_skills = skills
      .map((r) => ({ skill: r.skill.trim(), min_proficiency: Number(r.min_proficiency) || 3, mandatory: r.mandatory }))
      .filter((r) => r.skill.length > 0);
    if (required_skills.length === 0) {
      toast.error("Add at least one required skill.");
      return;
    }
    setBusy(true);
    if (recalc) setExplanation(null);
    try {
      const res = await planStaffing({ ...scenario, required_skills });
      setPlan(res);
      setProposalId(null);
      if (recalc) toast.success("What-if recalculated — trade-offs updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Planning failed");
    } finally {
      setBusy(false);
    }
  }, [scenario, skills]);

  const doExplain = async () => {
    if (!plan) return;
    setExplaining(true);
    try {
      const res = await explainStaffingScenario(plan.scenario_id);
      setExplanation(res.explanation);
      if (res.error) toast.info("Explanation model unavailable — the numbers above are still authoritative.");
    } catch {
      toast.error("Could not generate the explanation.");
    } finally {
      setExplaining(false);
    }
  };

  const doPropose = async () => {
    if (!plan || proposing) return;
    setProposing(true);
    try {
      const res = await proposeStaffingScenario(plan.scenario_id);
      // "Proposal submitted" only after the backend row exists.
      setProposalId(res.proposal_id);
      toast.success("Proposal submitted for human review.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Proposal failed — nothing was submitted.");
    } finally {
      setProposing(false);
    }
  };

  if (role && !can(role, "view_all_workforce") && !can(role, "view_team")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Staffing planner access only</h1>
          <p className="text-muted-foreground">The staffing planner is restricted to HR and People Managers.</p>
        </div>
      </AppShell>
    );
  }

  const isManager = role === "manager";
  const statusOf = (o: PlannerOption) => STATUS_META[o.status] ?? STATUS_META.insufficient_data;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Constrained staffing planner</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Scenario model. <span className="text-primary">Explicit constraints.</span>
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Define the demand, required skills, capacity, deadline and budget. The engine computes each option
            skill-by-skill with a status of feasible, conditional, infeasible or insufficient data — a 56-day hire is
            never clamped to a 42-day deadline, and a 54% match is never called role-ready.
          </p>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Your scope: {isManager ? "your team (manager scope is enforced in every query)" : "the organization"}.
            {isManager && " Candidate pipeline details are not exposed to managers."}
          </p>
        </div>

        {/* Scenario inputs */}
        <div className="mt-8 grid grid-cols-1 gap-4 rounded-lg bg-white p-5 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted-foreground">Scenario name</span>
            <Input value={scenario.name ?? ""} onChange={(e) => setScenario((s) => ({ ...s, name: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted-foreground">Demand / role</span>
            <Input value={scenario.demand_title ?? ""} onChange={(e) => setScenario((s) => ({ ...s, demand_title: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted-foreground">Deadline (days)</span>
            <Input type="number" min={1} value={scenario.deadline_days ?? 42} onChange={(e) => setScenario((s) => ({ ...s, deadline_days: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted-foreground">Budget (USD)</span>
            <Input type="number" min={0} value={scenario.budget_usd ?? 0} onChange={(e) => setScenario((s) => ({ ...s, budget_usd: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted-foreground">Capacity (people)</span>
            <Input type="number" min={1} value={scenario.capacity_people ?? 1} onChange={(e) => setScenario((s) => ({ ...s, capacity_people: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted-foreground">Geography</span>
            <Input value={scenario.geography ?? ""} onChange={(e) => setScenario((s) => ({ ...s, geography: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted-foreground">Horizon (months)</span>
            <Input type="number" min={1} value={scenario.horizon_months ?? 12} onChange={(e) => setScenario((s) => ({ ...s, horizon_months: Number(e.target.value) }))} />
          </label>
          <div className="flex items-end gap-2">
            <Button size="xl" className="flex-1" onClick={() => void run(plan !== null)} disabled={busy}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Scale className="h-5 w-5" />}
              {plan ? "Recalculate (what-if)" : "Run scenario"}
            </Button>
          </div>
        </div>

        {/* Required skills */}
        <div className="mt-4 flex flex-col gap-2 rounded-lg bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Required skills & minimum acceptable verified proficiency
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSkills((s) => [...s, { skill: "", min_proficiency: "3", mandatory: true }])}
            >
              + Add skill
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {skills.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-muted p-2">
                <Input value={r.skill} placeholder="Skill" onChange={(e) => setSkills((s) => s.map((x, j) => (j === i ? { ...x, skill: e.target.value } : x)))} className="h-9" />
                <Input type="number" min={1} max={5} value={r.min_proficiency} className="h-9 w-16" onChange={(e) => setSkills((s) => s.map((x, j) => (j === i ? { ...x, min_proficiency: e.target.value } : x)))} />
                <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                  <input type="checkbox" checked={r.mandatory} onChange={(e) => setSkills((s) => s.map((x, j) => (j === i ? { ...x, mandatory: e.target.checked } : x)))} />
                  mandatory
                </label>
                {skills.length > 1 && (
                  <button onClick={() => setSkills((s) => s.filter((_, j) => j !== i))} className="text-xs text-destructive" aria-label="Remove skill">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {busy && (
          <div className="mt-6 flex items-center gap-3 rounded-lg bg-muted p-6 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> Planning against your {isManager ? "team" : "org"} population and pipeline…
          </div>
        )}

        {plan && !busy && (
          <div className="mt-8 flex flex-col gap-6">
            {/* Compact scenario + decision table */}
            <div className="rounded-lg bg-foreground p-6 text-white">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/60">Scenario · {plan.scenario.name}</p>
                  <h2 className="mt-1 text-2xl font-extrabold">{plan.scenario.demand_title}</h2>
                  <p className="text-sm text-white/70">
                    Deadline {plan.scenario.deadline_days}d · Budget ${plan.scenario.budget_usd.toLocaleString()} · Capacity {plan.scenario.capacity_people} · Assumptions {plan.assumptions.version} · {plan.population_size} people in scope
                    {plan.candidate_pipeline_size !== null ? ` · ${plan.candidate_pipeline_size} candidate(s) in pipeline` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/20 text-white/60">
                      <th className="py-1.5 pr-3 font-bold uppercase">Option</th>
                      <th className="py-1.5 pr-3 font-bold uppercase">Status</th>
                      <th className="py-1.5 pr-3 font-bold uppercase">Ready (day)</th>
                      <th className="py-1.5 pr-3 font-bold uppercase">Cost</th>
                      <th className="py-1.5 pr-3 font-bold uppercase">Verified</th>
                      <th className="py-1.5 font-bold uppercase">Conditional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.decision_table.map((d) => {
                      const meta = STATUS_META[d.status] ?? STATUS_META.insufficient_data;
                      return (
                        <tr key={d.option_id} className="border-b border-white/10">
                          <td className="py-2 pr-3 font-bold capitalize">{d.option_id}</td>
                          <td className="py-2 pr-3"><span className={`rounded px-1.5 py-0.5 font-bold uppercase tracking-wider ${meta.cls}`}>{meta.label}</span></td>
                          <td className="py-2 pr-3">{d.ready_at_days}d</td>
                          <td className="py-2 pr-3">${d.cost_usd.toLocaleString()}</td>
                          <td className="py-2 pr-3">{d.verified_coverage_pct}%</td>
                          <td className="py-2">{d.conditional_coverage_pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-white/70">
                <Info className="mt-0.5 h-3 w-3 shrink-0" /> {plan.note}
              </p>
            </div>

            {/* Options */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {plan.options.map((o) => (
                <div key={o.id} className="flex flex-col gap-3 rounded-lg bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-lg font-extrabold text-foreground">
                      {o.id === "hire" ? <Users className="h-5 w-5 text-primary" /> : o.id === "move" ? <TrendingUp className="h-5 w-5 text-secondary" /> : o.id === "upskill" ? <CheckCircle2 className="h-5 w-5 text-accent" /> : <Scale className="h-5 w-5 text-foreground" />}
                      {o.label}
                    </h3>
                    <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${statusOf(o).cls}`}>{statusOf(o).label}</span>
                  </div>
                  {o.subject && <p className="text-xs font-semibold text-muted-foreground">Subject: {o.subject}</p>}

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md bg-muted p-3">
                      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Clock className="h-3 w-3" /> Ready</p>
                      <p className={`mt-1 text-2xl font-extrabold ${o.meets_deadline ? "text-foreground" : "text-destructive"}`}>{o.ready_at_days}d</p>
                      <p className="text-[10px] text-muted-foreground">deadline {plan.scenario.deadline_days}d</p>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Wallet className="h-3 w-3" /> Cost</p>
                      <p className="mt-1 text-2xl font-extrabold text-foreground">${o.cost_usd.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">budget ${plan.scenario.budget_usd.toLocaleString()}</p>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Users className="h-3 w-3" /> Coverage</p>
                      <p className="mt-1 text-2xl font-extrabold text-foreground">{o.verified_coverage_pct}%</p>
                      <p className="text-[10px] text-muted-foreground">conditional {o.conditional_coverage_pct}%</p>
                    </div>
                  </div>

                  {/* Skill-by-skill coverage */}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[360px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="py-1 pr-2 font-bold uppercase">Skill</th>
                          <th className="py-1 pr-2 font-bold uppercase">Bar</th>
                          <th className="py-1 pr-2 font-bold uppercase">Coverage</th>
                          <th className="py-1 pr-2 font-bold uppercase">Now → Projected</th>
                          <th className="py-1 font-bold uppercase">Mandatory</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.skill_coverage.map((r) => (
                          <tr key={r.skill} className="border-b border-border/50">
                            <td className="py-1.5 pr-2 font-semibold text-foreground">{r.skill}</td>
                            <td className="py-1.5 pr-2">{r.min_proficiency}/5</td>
                            <td className="py-1.5 pr-2">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${COVERAGE_META[r.coverage]?.cls}`}>{COVERAGE_META[r.coverage]?.label ?? r.coverage}</span>
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">{r.current_proficiency ?? "—"} → {r.projected_proficiency ?? "—"}</td>
                            <td className="py-1.5">{r.mandatory ? (r.mandatory_satisfied ? <CheckCircle2 className="h-3.5 w-3.5 text-secondary" /> : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />) : "no"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Timeline */}
                  <div className="flex flex-wrap gap-1.5">
                    {o.timeline.map((s) => (
                      <span key={s.name} className={`rounded bg-muted px-2 py-1 text-[11px] font-semibold text-foreground ${s.parallel ? "ring-1 ring-inset ring-primary/40" : ""}`}>
                        {s.name} · {s.duration_days}d{s.parallel ? " (parallel)" : ""}
                      </span>
                    ))}
                  </div>

                  <p className="rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">{o.status_reason}</p>

                  {(o.constraints_violated.length > 0 || o.constraints_satisfied.length > 0) && (
                    <ul className="flex flex-col gap-1 text-[11px]">
                      {o.constraints_satisfied.map((c) => (
                        <li key={c} className="flex items-start gap-1.5 text-secondary"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> {c}</li>
                      ))}
                      {o.constraints_violated.map((c) => (
                        <li key={c} className="flex items-start gap-1.5 text-destructive"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {c}</li>
                      ))}
                    </ul>
                  )}

                  <p className="text-xs italic leading-relaxed text-muted-foreground">{o.rationale}</p>
                </div>
              ))}
            </div>

            {/* Actions: explain + propose */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-4">
              <Button variant="outline" onClick={() => void doExplain()} disabled={explaining}>
                {explaining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Explain scenario
              </Button>
              <Button onClick={() => void doPropose()} disabled={proposing || proposalId !== null}>
                {proposing ? <Loader2 className="h-4 w-4 animate-spin" /> : proposalId ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {proposalId ? `Proposal submitted (${proposalId.slice(0, 8)})` : "Send to human review"}
              </Button>
            </div>

            {explanation && (
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <MessageSquareText className="h-4 w-4" /> Scenario explanation (narrates the planner's validated numbers only)
                </p>
                <p className="mt-2 text-sm leading-relaxed text-foreground">{explanation}</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Scenario "{plan.scenario.name}" is saved with its input snapshot and assumptions (assumptions v{plan.assumptions.version}). Changing any input above and pressing Recalculate recomputes and exposes the trade-offs.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
