import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { RoleScopeCallout } from "@/components/role-scope-callout";
import { can } from "@/lib/rbac";
import {
  explainStaffingScenario,
  listStaffingScenarios,
  planStaffing,
  proposeStaffingScenario,
  reviewStaffingProposal,
  type PlannerOption,
  type StaffingPlanInput,
  type StaffingPlanResult,
} from "@/lib/api";
import { Textarea } from "@/components/ui/textarea";
import { recommendOption, RECOMMENDATION_RULE, RECOMMENDATION_RULE_SHORT } from "@/lib/staffing-recommendation";
import { isInputFingerprintOutdated, isProposalStale } from "@/lib/staffing-staleness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Edit3,
  Inbox,
  Info,
  Loader2,
  Lock,
  MessageSquareText,
  RefreshCw,
  Scale,
  SearchCheck,
  Send,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
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

/** Clearly-labeled fictional scenario presets. Selecting one POPULATES the
 *  editable inputs — it never auto-submits or auto-runs. */
const SCENARIO_PRESETS: {
  id: string;
  label: string;
  description: string;
  scenario: StaffingPlanInput;
  skills: SkillRow[];
}[] = [
  {
    id: "backend-45",
    label: "Staff a backend platform project in 45 days",
    description: "Fictional scenario — fills the demand, skills, deadline and budget so you can edit and run.",
    scenario: {
      name: "Backend platform project — 45 days",
      demand_title: "Senior Backend Engineer",
      deadline_days: 45,
      budget_usd: 80000,
      capacity_people: 1,
      geography: "US",
      horizon_months: 12,
    },
    skills: [
      { skill: "Go", min_proficiency: "4", mandatory: true },
      { skill: "REST APIs", min_proficiency: "3", mandatory: true },
      { skill: "PostgreSQL", min_proficiency: "3", mandatory: true },
      { skill: "Docker", min_proficiency: "3", mandatory: false },
    ],
  },
  {
    id: "data-90",
    label: "Close a data capability gap in 90 days",
    description: "Fictional scenario — fills the demand, skills, deadline and budget so you can edit and run.",
    scenario: {
      name: "Data capability gap — 90 days",
      demand_title: "Data Analyst",
      deadline_days: 90,
      budget_usd: 55000,
      capacity_people: 1,
      geography: "US",
      horizon_months: 12,
    },
    skills: [
      { skill: "SQL", min_proficiency: "4", mandatory: true },
      { skill: "Python", min_proficiency: "3", mandatory: true },
      { skill: "Tableau", min_proficiency: "3", mandatory: false },
      { skill: "Data Modeling", min_proficiency: "3", mandatory: false },
    ],
  },
];

// Batch F (F2): the staffing flow is explicit — Define → Compare → Review →
// Approve. The stepper reflects where the user is; comparison comes FIRST.
const STEPS = [
  { key: "define", label: "Define", icon: Edit3 },
  { key: "compare", label: "Compare", icon: Scale },
  { key: "review", label: "Review", icon: SearchCheck },
  { key: "approve", label: "Approve", icon: BadgeCheck },
] as const;

function summaryOf(o: PlannerOption): string {
  if (o.subject) return o.subject;
  const firstViolation = o.constraints_violated[0];
  if (firstViolation) return firstViolation;
  return o.status_reason.slice(0, 90);
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
  // Batch F (F2): the user picks the option they want reviewed, and the
  // proposal binds that option + the scenario version it was computed at.
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ id: string; option_id: string; option_label: string; scenario_version: string } | null>(null);
  // Phase 15 (Batch A3): dirty-input protection — the saved plan is bound to an
  // exact input fingerprint; changed inputs mark it outdated and block
  // explain/propose until recalculated.
  const [inputFingerprint, setInputFingerprint] = useState<string | null>(null);
  const [runVersion, setRunVersion] = useState(0);
  const fingerprint = JSON.stringify({ scenario, skills });

  // Batch 9: staleness is computed via pure, tested helpers. Dirty inputs
  // block explain/propose; a proposal bound to an older scenario version is
  // flagged so it is never mistaken for a fresh computation.
  const outdated = isInputFingerprintOutdated(!!plan, inputFingerprint, fingerprint);
  const proposalStale =
    proposal !== null && plan !== null && isProposalStale(proposal.scenario_version, plan.assumptions.version);
  const stepIndex = !plan ? 0 : !selectedOption ? 1 : !proposal ? 2 : 3;
  const recommendedId = plan ? recommendOption(plan.options) : null;
  const selectedOptionRow = plan?.options.find((o) => o.id === selectedOption) ?? null;

  // Page access mirrors the server-side gate; the query below only fires for
  // authorized visitors (hooks must run unconditionally, before the early
  // return).
  const staffingAccess = !!role && (can(role, "view_all_workforce") || can(role, "view_team"));

  // Batch 10: human-review loop — submitted proposals are listed (server-scoped
  // to the caller's org or team) and HR reviewers can approve/decline them.
  const canReview = can(role, "review_staffing_proposals");
  const proposalsQuery = useQuery({
    queryKey: ["staffing-proposals"],
    queryFn: listStaffingScenarios,
    enabled: staffingAccess,
    staleTime: 30_000,
  });
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const doReview = async (proposalId: string, decision: "approved" | "declined") => {
    setReviewBusy(true);
    try {
      const res = await reviewStaffingProposal(proposalId, decision, reviewNote.trim());
      toast.success(res.message);
      setReviewNote("");
      setReviewingId(null);
      void proposalsQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed — the proposal was not changed.");
    } finally {
      setReviewBusy(false);
    }
  };

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
    const version = runVersion + 1;
    setRunVersion(version);
    try {
      const res = await planStaffing({ ...scenario, required_skills });
      // Ignore late responses from superseded input runs.
      if (version !== runVersion + 1) return;
      setPlan(res);
      setInputFingerprint(JSON.stringify({ scenario, required_skills }));
      setSelectedOption(null);
      setProposal(null);
      if (recalc) toast.success("What-if recalculated — trade-offs updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Planning failed");
    } finally {
      setBusy(false);
    }
  }, [scenario, skills, runVersion]);

  const doExplain = async () => {
    if (!plan || outdated || explaining) return;
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
    if (!plan || outdated || proposing || !selectedOption) return;
    setProposing(true);
    try {
      const res = await proposeStaffingScenario(plan.scenario_id, selectedOption);
      // "Proposal submitted" only after the backend row exists AND the selected
      // option + scenario version were persisted with it.
      setProposal({ id: res.proposal_id, option_id: res.option_id, option_label: res.option_label, scenario_version: res.scenario_version });
      toast.success("Proposal submitted for human review.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Proposal failed — nothing was submitted.");
    } finally {
      setProposing(false);
    }
  };

  if (!staffingAccess) {
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
            Plan how to staff a role or project. <span className="text-primary">Explicit constraints.</span>
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Define the demand, required skills, capacity, deadline and budget. The engine computes each option
            skill-by-skill with a status of feasible, conditional, infeasible or insufficient data — a 56-day hire is
            never clamped to a 42-day deadline, and a 54% match is never called role-ready.
          </p>
          <RoleScopeCallout page="staffing" role={role} />
        </div>

        {/* Batch F (F2): Define → Compare → Review → Approve stepper */}
        <ol className="mt-6 flex flex-wrap items-center gap-y-2 rounded-lg bg-white p-3 shadow-sm" aria-label="Staffing flow">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < stepIndex;
            const current = i === stepIndex;
            return (
              <li key={s.key} className="flex flex-1 items-center gap-2 last:flex-none">
                <span
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-bold ${
                    current ? "bg-primary text-white" : done ? "bg-secondary/15 text-secondary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.5} />
                  {s.label}
                  {done && <CheckCircle2 className="h-3.5 w-3.5" />}
                </span>
                {i < STEPS.length - 1 && <span className="mx-2 hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        {/* Scenario presets — populate editable inputs, never auto-submit */}
        <div className="mt-6 rounded-lg bg-muted/60 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Scenario presets (fictional demo data) — select one to fill the editable form
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {SCENARIO_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setScenario(p.scenario);
                  setSkills(p.skills.map((s) => ({ ...s })));
                  setPlan(null);
                  setSelectedOption(null);
                  setProposal(null);
                  setInputFingerprint(null);
                  toast.success(`Preset loaded: ${p.label}. Review the inputs, then run the scenario.`);
                }}
                className="rounded-md bg-white px-3 py-2 text-left text-xs shadow-sm ring-1 ring-border transition-all hover:scale-[1.01] hover:ring-primary/40"
              >
                <span className="block font-bold text-foreground">{p.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{p.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Scenario inputs — Define */}
        <div className="mt-6 grid grid-cols-1 gap-4 rounded-lg bg-white p-5 lg:grid-cols-4">
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
            {/* Scenario summary bar */}
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
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-white/70">
                <Info className="mt-0.5 h-3 w-3 shrink-0" /> {plan.note}
              </p>
            </div>

            {/* Batch F (F2): COMPARISON FIRST — the decision table is the first
                thing after the scenario. The recommendation rule is stated
                explicitly and the recommended option is highlighted. */}
            <div className="rounded-lg bg-white p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                  <Scale className="h-5 w-5 text-primary" strokeWidth={2.5} /> Compare options
                </h2>
                {recommendedId && (
                  <span className="ml-auto flex items-center gap-1 rounded-md bg-secondary/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
                    <BadgeCheck className="h-3.5 w-3.5" /> Recommended
                  </span>
                )}
              </div>
              <p className="mt-1 flex items-start gap-1.5 rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  <b>Rule:</b> {RECOMMENDATION_RULE}
                  {!recommendedId && " No option currently qualifies — none is marked recommended, and each option below states why it fails."}
                </span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Pick the option you want reviewed, then continue to Review &amp; Approve. Readiness is conditional wherever coverage is
                training/verification-based (never a bare score).
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead>
                    <tr className="border-b-2 border-border text-muted-foreground">
                      <th className="py-2 pr-3 font-bold uppercase" aria-label="Select">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="py-2 pr-3 font-bold uppercase">Option</th>
                      <th className="py-2 pr-3 font-bold uppercase">Status</th>
                      <th className="py-2 pr-3 font-bold uppercase">Ready</th>
                      <th className="py-2 pr-3 font-bold uppercase">Cost</th>
                      <th className="py-2 pr-3 font-bold uppercase">Verified</th>
                      <th className="py-2 font-bold uppercase">Conditional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.options.map((o) => {
                      const meta = statusOf(o);
                      const isRecommended = o.id === recommendedId;
                      const isSelected = o.id === selectedOption;
                      return (
                        <tr
                          key={o.id}
                          onClick={() => setSelectedOption(o.id)}
                          className={`cursor-pointer border-b border-border/60 transition-colors ${isRecommended ? "bg-secondary/10" : isSelected ? "bg-primary/10" : "hover:bg-muted/60"}`}
                        >
                          <td className="py-3 pl-2 pr-3">
                            <input
                              type="radio"
                              name="staffing-option"
                              checked={isSelected}
                              onChange={() => setSelectedOption(o.id)}
                              aria-label={`Select ${o.label}`}
                              className="accent-[hsl(var(--primary))]"
                            />
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-extrabold capitalize text-foreground">{o.label}</span>
                              {isRecommended && (
                                <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">Best</span>
                              )}
                            </div>
                            <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-muted-foreground" title={o.status_reason}>
                              {summaryOf(o)}
                            </p>
                          </td>
                          <td className="py-3 pr-3"><span className={`rounded px-1.5 py-0.5 font-bold uppercase tracking-wider ${meta.cls}`}>{meta.label}</span></td>
                          <td className="py-3 pr-3">
                            <span className={o.meets_deadline ? "font-bold text-foreground" : "font-bold text-destructive"}>{o.ready_at_days}d</span>
                            <span className="text-[10px] text-muted-foreground"> / {plan.scenario.deadline_days}d</span>
                          </td>
                          <td className="py-3 pr-3">
                            <span className={o.budget_satisfied ? "font-semibold text-foreground" : "font-semibold text-destructive"}>${o.cost_usd.toLocaleString()}</span>
                          </td>
                          <td className="py-3 pr-3 font-bold text-foreground">{o.verified_coverage_pct}%</td>
                          <td className="py-3 font-bold text-muted-foreground">{o.conditional_coverage_pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Recommended = {RECOMMENDATION_RULE_SHORT}. Infeasible and insufficient-data options are never recommended.
              </p>
            </div>

            {/* Detailed option cards */}
            <div>
              <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                <SearchCheck className="h-5 w-5 text-secondary" strokeWidth={2.5} /> Option detail — review the evidence
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {plan.options.map((o) => (
                  <div key={o.id} className={`flex flex-col gap-3 rounded-lg bg-white p-5 ${o.id === recommendedId ? "ring-2 ring-secondary/50" : ""}`}>
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
            </div>

            {/* Batch F (F2): Review & Approve — the selected option binds the
                proposal. Explain stays available; "Send to human review" is
                disabled until an option is selected (and re-enabled only via a
                fresh, non-outdated plan). */}
            {outdated && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-100 p-4 text-amber-900">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <p className="flex-1 text-sm font-semibold">
                  Inputs changed — this plan is outdated. Recalculate before explaining or proposing.
                </p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-4">
              <Button variant="outline" onClick={() => void doExplain()} disabled={explaining || outdated}>
                {explaining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Explain scenario
              </Button>
              <Button onClick={() => void doPropose()} disabled={proposing || outdated || !selectedOption || proposal !== null}>
                {proposing ? <Loader2 className="h-4 w-4 animate-spin" /> : proposal ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {proposal ? "Proposal submitted" : "Send selected option to human review"}
              </Button>
              {!selectedOption && !proposal && (
                <span className="text-xs font-semibold text-muted-foreground">
                  Select an option in the comparison table above to review it for submission.
                </span>
              )}
            </div>

            {/* Selected option binding summary / submitted proposal */}
            {proposal ? (
              <div className="rounded-lg border-2 border-secondary/40 bg-secondary/10 p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-secondary">
                  <BadgeCheck className="h-4 w-4" /> Proposal submitted — bound to the exact option and scenario version
                </p>
                <p className="mt-2 text-sm font-bold text-foreground">
                  Option: <span className="capitalize">{proposal.option_label}</span>
                  {selectedOptionRow?.subject ? ` · ${selectedOptionRow.subject}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Scenario version: <code className="rounded bg-muted px-1.5 py-0.5">{proposal.scenario_version}</code> · Proposal {proposal.id.slice(0, 8)} — the human reviewer sees exactly these numbers, not a re-computation.
                </p>
                {proposalStale && (
                  <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    This proposal is bound to assumptions {proposal.scenario_version}, but the current plan runs on assumptions {plan.assumptions.version}. The reviewer will still see the bound numbers, but a fresh computation would differ — resubmit after recalculating if the inputs changed.
                  </div>
                )}
              </div>
            ) : selectedOptionRow && selectedOption ? (
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <SearchCheck className="h-4 w-4" /> Review selection
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  You selected <b className="capitalize">{selectedOptionRow.label}</b>
                  {selectedOptionRow.subject ? ` (subject: ${selectedOptionRow.subject})` : ""} — ready day {selectedOptionRow.ready_at_days}, $
                  {selectedOptionRow.cost_usd.toLocaleString()}, {selectedOptionRow.verified_coverage_pct}% verified coverage.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Submitting binds this option and the current scenario version (assumptions {plan.assumptions.version}). Recalculate after changing inputs so the proposal always matches what was reviewed.
                </p>
              </div>
            ) : null}

            {explanation && (
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <MessageSquareText className="h-4 w-4" /> Scenario explanation (narrates the planner's validated numbers only)
                </p>
                <p className="mt-2 text-sm leading-relaxed text-foreground">{explanation}</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Scenario "{plan.scenario.name}" is saved with its input snapshot and assumptions (assumptions v{plan.assumptions.version}). Changing any input above and pressing Recalculate recomputes and exposes the trade-offs; a proposal always carries the option and version it was computed at.
            </p>
          </div>
        )}

        {/* Batch 10: submitted proposals — the human-review loop. Decisions are
            durable (status, reviewer, note, timestamp); HR approves/declines. */}
        <section className="mt-10 flex flex-col gap-4" aria-label="Submitted staffing proposals">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-extrabold tracking-tight text-foreground">Submitted proposals — human review</h2>
              {canReview && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                  Reviewer: HR
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => void proposalsQuery.refetch()} disabled={proposalsQuery.isFetching}>
              {proposalsQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>

          {proposalsQuery.isPending ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading proposals…
            </div>
          ) : proposalsQuery.isError ? (
            <div role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Could not load proposals — {(proposalsQuery.error as Error)?.message ?? "unknown error"}.{" "}
              <button className="underline" onClick={() => void proposalsQuery.refetch()}>Retry</button>
            </div>
          ) : !proposalsQuery.data?.proposals?.length ? (
            <div className="flex items-center gap-3 rounded-lg bg-white p-6 text-sm text-muted-foreground">
              <Inbox className="h-5 w-5 shrink-0" />
              No submitted proposals yet. Run a scenario, select an option above, and send it to human review.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {proposalsQuery.data.proposals.map((p) => {
                const open = p.status === "open";
                const reviewing = reviewingId === p.id;
                return (
                  <li key={p.id} className="rounded-lg bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                          <span className="capitalize">{p.option_label ?? "Option"}</span>
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                              open ? "bg-accent text-foreground" : p.status === "approved" ? "bg-secondary text-white" : "bg-destructive/15 text-destructive"
                            }`}
                          >
                            {p.status}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Submitted by <span className="font-semibold text-foreground">{p.submitted_by_name ?? p.submitted_by?.slice(0, 8) ?? "unknown"}</span>
                          {" · "}
                          {new Date(p.created_at).toLocaleString()}
                          {p.scenario_version ? <span className="ml-1 text-muted-foreground">· v{p.scenario_version}</span> : null}
                        </p>
                        {p.review_note && (
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Review note: <span className="italic">{p.review_note}</span>
                          </p>
                        )}
                        {p.reviewed_by_name && p.reviewed_at && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {p.status === "approved" ? (
                              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-secondary" />
                            ) : (
                              <XCircle className="mr-1 inline h-3.5 w-3.5 text-destructive" />
                            )}
                            Decided by {p.reviewed_by_name} on {new Date(p.reviewed_at).toLocaleString()}
                          </p>
                        )}
                      </div>

                      {canReview && open && (
                        <div className="flex flex-col items-end gap-2">
                          {reviewing ? (
                            <div className="flex w-full flex-col gap-2 sm:w-80">
                              <Textarea
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value)}
                                placeholder="Review note (optional — shown to the submitter)"
                                rows={3}
                              />
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" disabled={reviewBusy} onClick={() => setReviewingId(null)}>
                                  Cancel
                                </Button>
                                <Button size="sm" disabled={reviewBusy} onClick={() => void doReview(p.id, "approved")}>
                                  {reviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
                                </Button>
                                <Button size="sm" variant="destructive" disabled={reviewBusy} onClick={() => void doReview(p.id, "declined")}>
                                  <XCircle className="h-4 w-4" /> Decline
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button size="sm" onClick={() => { setReviewingId(p.id); setReviewNote(""); }}>
                              <SearchCheck className="h-4 w-4" /> Review
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
