import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRight,
  Briefcase,
  ClipboardList,
  FileText,
  History,
  Loader2,
  Lock,
  MessagesSquare,
  Plus,
  Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { FitCard } from "@/components/fit-card";
import { ResumeReviewFlow } from "@/components/resume-review-flow";
import { AssessmentReviewPanel } from "@/components/assessment-review-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { can } from "@/lib/rbac";
import {
  computeSkillFit,
  type FitLineage,
  type FitRecord,
} from "@/lib/skill-graph";
import {
  ApiError,
  applicationStage,
  evaluateInterview,
  extractResume,
  fetchModelJob,
  generateInterviewKit,
  requisitionCreate,
  type ApplicationRow,
  type InterviewEvaluation,
  type InterviewKit,
  type StageEventRow,
} from "@/lib/api";

interface Applicant {
  twin_id: string;
  stage: string;
  match_score: number | null;
}

interface ReqRow {
  id: string;
  title: string;
  department: string;
  status: string;
  seniority_level: number;
  required_skills: { skill: string; target_proficiency: number }[];
  future_skills: { skill: string; target_proficiency: number }[];
  applicants: Applicant[];
}

const REQ_STATUS_CLASS: Record<string, string> = {
  open: "bg-primary text-white",
  on_hold: "bg-accent text-foreground",
  filled: "bg-secondary text-white",
  closed: "bg-muted text-foreground",
};

interface CandidateRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

const STAGE_LABEL: Record<string, string> = {
  screening: "Under Review",
  technical_interview: "Interview Scheduled",
  final_round: "Decision Pending",
  selected: "Offer Extended",
  rejected: "Not moving forward",
};

const STAGE_CLASS: Record<string, string> = {
  screening: "bg-accent text-foreground",
  technical_interview: "bg-primary text-white",
  final_round: "bg-secondary text-white",
  selected: "bg-foreground text-white",
  rejected: "bg-destructive text-white",
};

function SkillsChips({ skills }: { skills: { skill: string; target_proficiency: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s) => (
        <span key={s.skill} className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">
          {s.skill} · {s.target_proficiency}
        </span>
      ))}
    </div>
  );
}

export default function Recruitment() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [recoveredJob, setRecoveredJob] = useState<{ id: string; status: string; task: string; error_message?: string | null } | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [creating, setCreating] = useState(false);

  // Refresh recovery: re-read a completed generation job from the URL.
  useEffect(() => {
    const jobParam = searchParams.get("job");
    if (!jobParam) return;
    void fetchModelJob(jobParam)
      .then((res) =>
        setRecoveredJob({
          id: res.job.id,
          status: res.job.status,
          task: res.job.task,
          error_message: res.job.error_message,
        })
      )
      .catch(() => setRecoveredJob({ id: jobParam, status: "unavailable", task: "generation" }));
  }, [searchParams]);

  // Create-requisition form
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [level, setLevel] = useState(3);
  const [reqSkills, setReqSkills] = useState("");
  const [futSkills, setFutSkills] = useState("");

  // Per-action state
  const [fit, setFit] = useState<FitRecord | null>(null);
  const [fitLineage, setFitLineage] = useState<FitLineage | null>(null);
  const [kit, setKit] = useState<InterviewKit | null>(null);
  const [evalRes, setEvalRes] = useState<InterviewEvaluation | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Resume modal
  const [resumeTwin, setResumeTwin] = useState<CandidateRow | null>(null);
  const [resumeMode, setResumeMode] = useState<"file" | "text">("file");
  const [resumeText, setResumeText] = useState("");
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractResult, setExtractResult] = useState<{ skills: string[]; years: number; fit: number | null } | null>(null);
  // Evaluate modal
  const [evalTwin, setEvalTwin] = useState<CandidateRow | null>(null);
  const [evalNotes, setEvalNotes] = useState("");
  const [evalBusy, setEvalBusy] = useState(false);

  // Phase 6: application lifecycle + assessments
  const [historyApp, setHistoryApp] = useState<ApplicationRow | null>(null);
  const [historyEvents, setHistoryEvents] = useState<StageEventRow[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [assessApp, setAssessApp] = useState<{ application: ApplicationRow; candidate: CandidateRow } | null>(null);

  const reqs = useQuery({
    queryKey: ["recruiter-reqs", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase.from("job_requisitions").select("*").order("created_at", { ascending: false });
      return (data ?? []) as ReqRow[];
    },
  });

  // Authoritative application rows + transition history for the selected requisition.
  const apps = useQuery({
    queryKey: ["recruiter-apps", selected, user?.id ?? "anon"],
    queryFn: async () => {
      if (!selected) return { apps: [], events: [] };
      const { data: rows } = await supabase
        .from("applications")
        .select("*")
        .eq("requisition_id", selected)
        .order("applied_at");
      const appRows = (rows ?? []) as ApplicationRow[];
      const appIds = appRows.map((a) => a.id);
      const { data: evRows } = appIds.length > 0
        ? await supabase
            .from("application_stage_events")
            .select("id, application_id, prior_stage, new_stage, reason, at, version, actor_twin_id")
            .in("application_id", appIds)
            .order("at", { ascending: true })
        : { data: [] };
      return { apps: appRows, events: (evRows ?? []) as StageEventRow[] };
    },
  });

  const candidates = useQuery({
    queryKey: ["recruiter-candidates", user?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("digital_twins")
        .select("id, name, email, role, status")
        .eq("role", "candidate")
        .order("name");
      return (data ?? []) as CandidateRow[];
    },
  });

  const candidatesMap = new Map((candidates.data ?? []).map((c) => [c.id, c]));
  const req = reqs.data?.find((r) => r.id === selected) ?? null;
  const appsByTwin = new Map((apps.data?.apps ?? []).map((a) => [a.candidate_twin_id, a]));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["recruiter-reqs", user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["recruiter-candidates", user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["recruiter-apps", selected, user?.id ?? "anon"] });
  };

  const handleCreate = async () => {
    const required = reqSkills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s, i) => ({ skill: s, target_proficiency: i < 2 ? 3 : 2 }));
    if (!title.trim() || !dept.trim() || required.length === 0) {
      toast.error("Title, department and at least one required skill are needed.");
      return;
    }
    setCreating(true);
    try {
      await requisitionCreate({
        title: title.trim(),
        department: dept.trim(),
        seniority_level: level,
        required_skills: required,
        future_skills: futSkills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => ({ skill: s, target_proficiency: 2 })),
      });
      toast.success("Requisition created.");
      setTitle("");
      setDept("");
      setReqSkills("");
      setFutSkills("");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  // Authorized stage transitions via the server matrix (applications is the
  // source of truth; expected_stage/version guard against stale writes).
  const runStage = async (c: CandidateRow, decision: "move_forward" | "reject" | "select") => {
    const app = appsByTwin.get(c.id);
    if (!app) {
      toast.error("No application record for this candidate.");
      return;
    }
    setBusyAction(`${decision}-${c.id}`);
    try {
      const res = await applicationStage(
        app.id,
        decision,
        app.stage,
        app.version,
        decision === "select" ? "Selected by recruiter." : undefined
      );
      toast.success(
        decision === "select"
          ? `${c.name} converted to employee — pre-hire data preserved.`
          : `${c.name}: ${res.reason ?? "Stage updated."}`
      );
      invalidate();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STALE_STATE") {
        toast.error(err.message);
        invalidate();
      } else {
        toast.error(err instanceof Error ? err.message : "Decision failed");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const showHistory = async (c: CandidateRow) => {
    const app = appsByTwin.get(c.id);
    if (!app) return;
    setHistoryApp(app);
    setHistoryBusy(true);
    setHistoryEvents([]);
    try {
      const { data } = await supabase
        .from("application_stage_events")
        .select("id, application_id, prior_stage, new_stage, reason, at, version, actor_twin_id")
        .eq("application_id", app.id)
        .order("at", { ascending: true });
      setHistoryEvents((data ?? []) as StageEventRow[]);
    } catch {
      toast.error("Could not load transition history.");
    } finally {
      setHistoryBusy(false);
    }
  };

  const showFit = async (c: CandidateRow) => {
    if (!req) return;
    setBusyAction(`fit-${c.id}`);
    setFit(null);
    setFitLineage(null);
    try {
      const res = await computeSkillFit({ twin_id: c.id, target_id: req.id, scenario: "current" });
      setFit(res.fit);
      setFitLineage(res.lineage ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fit failed");
    } finally {
      setBusyAction(null);
    }
  };

  const showKit = async (c: CandidateRow) => {
    if (!req) return;
    setBusyAction(`kit-${c.id}`);
    setKit(null);
    try {
      // Local 4B model: pre-generate rubrics one competency per call (each is
      // cached per role and completes reliably), then the kit runs its single
      // candidate-biased probe.
      for (const comp of [...req.required_skills.map((s) => s.skill), "Collaboration"]) {
        await generateRubrics(req.id, [comp]);
      }
      const res = await generateInterviewKit(c.id, req.id);
      setKit(res.kit);
      toast.success(`Interview kit ready — probes biased to ${res.kit.focus_items.join(", ") || "core skills"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kit failed");
    } finally {
      setBusyAction(null);
    }
  };

  const runExtract = async () => {
    if (!resumeTwin || !req) return;
    if (resumeText.trim().length < 20) {
      toast.error("Paste at least 20 characters of resume.");
      return;
    }
    setExtractBusy(true);
    setExtractResult(null);
    try {
      const res = await extractResume(resumeTwin.id, resumeText, req.id);
      setSearchParams({ job: res.job_id }, { replace: true });
      setExtractResult({
        skills: res.extracted_skills.map((s) => s.name),
        years: res.years_experience ?? 0,
        fit: res.fit?.score ?? null,
      });
      toast.success("Resume extracted — structured skills persisted; match computed by the deterministic engine.");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtractBusy(false);
    }
  };

  const runEvaluate = async () => {
    if (!evalTwin || !req) return;
    if (evalNotes.trim().length < 10) {
      toast.error("Add interview notes first.");
      return;
    }
    setEvalBusy(true);
    setEvalRes(null);
    try {
      const res = await evaluateInterview(evalTwin.id, req.id, evalNotes);
      setEvalRes(res.evaluation);
      toast.success("Structured evaluation recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setEvalBusy(false);
    }
  };

  if (role && !can(role, "manage_recruitment")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Recruitment access only</h1>
          <p className="text-muted-foreground">This studio is restricted to Technical Recruiters and Administrators.</p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Recruitment & Interview Studio</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Rank. Interview. Decide.
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            The Skill Intelligence Graph ranks every applicant; interview kits are biased to each candidate's gaps;
            "Select" converts the DigitalTwin to employee in one transaction.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {recoveredJob && (
            <div className="col-span-full rounded-lg bg-muted p-4 text-sm">
              <span className="font-bold text-foreground">Recovered job #{recoveredJob.id.slice(0, 8)}</span>
              <span className="ml-2 text-muted-foreground">
                task: {recoveredJob.task} · status:{" "}
                <b className={recoveredJob.status === "succeeded" ? "text-secondary" : "text-destructive"}>
                  {recoveredJob.status}
                </b>
                {recoveredJob.error_message ? ` · ${recoveredJob.error_message.slice(0, 120)}` : ""}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRecoveredJob(null);
                  setSearchParams({}, { replace: true });
                }}
                className="ml-3 text-xs font-semibold text-primary"
              >
                Dismiss
              </button>
            </div>
          )}
          {/* Left: create + requisition list */}
          <div className="flex flex-col gap-6">
            <div className="rounded-lg bg-white p-5">
              <h2 className="text-base font-extrabold text-foreground">New requisition</h2>
              <div className="mt-3 flex flex-col gap-3">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. DevOps Engineer" />
                <Input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Department, e.g. Platform" />
                <select
                  value={level}
                  onChange={(e) => setLevel(Number(e.target.value))}
                  className="h-11 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
                >
                  {[1, 2, 3, 4, 5].map((l) => (
                    <option key={l} value={l}>
                      Seniority level {l}
                    </option>
                  ))}
                </select>
                <Input value={reqSkills} onChange={(e) => setReqSkills(e.target.value)} placeholder="Required skills (comma separated)" />
                <Input value={futSkills} onChange={(e) => setFutSkills(e.target.value)} placeholder="Future skills (12–24 mo, optional)" />
                <Button onClick={() => void handleCreate()} disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create requisition
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Requisitions</h2>
              {(reqs.data ?? []).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`flex items-center justify-between rounded-lg p-4 text-left transition-all duration-200 hover:scale-[1.02] ${
                    selected === r.id ? "bg-foreground text-white" : "bg-white text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-2 font-bold">
                    <Briefcase className="h-4 w-4" />
                    {r.title}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${REQ_STATUS_CLASS[r.status] ?? "bg-muted text-foreground"}`}>
                      {r.status.replace(/_/g, " ")}
                    </span>
                    <span className={`text-xs ${selected === r.id ? "text-white/70" : "text-muted-foreground"}`}>
                      {r.applicants.length} applicant{r.applicants.length === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              ))}
              {reqs.data && reqs.data.length === 0 && (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No requisitions yet.</p>
              )}
            </div>
          </div>

          {/* Main: selected requisition */}
          <div className="lg:col-span-2">
            {!req ? (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-20 text-center">
                <Briefcase className="h-8 w-8 text-primary" strokeWidth={2.5} />
                <p className="text-sm text-muted-foreground">Select a requisition to manage its pipeline.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-lg bg-white p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-extrabold tracking-tight text-foreground">{req.title}</h2>
                      <p className="text-sm text-muted-foreground">
                        {req.department} · Seniority {req.seniority_level}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${REQ_STATUS_CLASS[req.status] ?? "bg-muted text-foreground"}`}>
                        {req.status.replace(/_/g, " ")}
                      </span>
                      <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white">
                        {req.applicants.length} in pipeline
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Required</span>
                      <SkillsChips skills={req.required_skills} />
                    </div>
                    {req.future_skills.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Future</span>
                        <SkillsChips skills={req.future_skills} />
                      </div>
                    )}
                  </div>
                </div>

                {req.applicants.length === 0 && (
                  <div className="flex items-center gap-3 rounded-lg bg-muted p-6 text-sm text-muted-foreground">
                    <FileText className="h-5 w-5" /> No applicants yet — apply a candidate via the studio API or seed data.
                  </div>
                )}

                {req.applicants
                  .filter((a) => a.stage !== "rejected")
                  .map((a) => {
                    const c = candidatesMap.get(a.twin_id);
                    if (!c) return null;
                    const app = appsByTwin.get(a.twin_id);
                    const stage = app?.stage ?? a.stage;
                    return (
                      <div key={a.twin_id} className="rounded-lg bg-white p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-bold text-foreground">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.email}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {app && (
                              <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                                v{app.version}
                              </span>
                            )}
                            <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${STAGE_CLASS[stage] ?? "bg-muted text-foreground"}`}>
                              {STAGE_LABEL[stage] ?? stage.replace(/_/g, " ")}
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" onClick={() => void showFit(c)} disabled={busyAction === `fit-${c.id}`}>
                            {busyAction === `fit-${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />} Fit card
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => void showKit(c)} disabled={busyAction === `kit-${c.id}`}>
                            {busyAction === `kit-${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessagesSquare className="h-4 w-4" />} Interview kit
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => { setResumeTwin(c); setResumeText(""); setExtractResult(null); }}>
                            <FileText className="h-4 w-4" /> Resume
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => { setEvalTwin(c); setEvalNotes(""); setEvalRes(null); }}>
                            <MessagesSquare className="h-4 w-4" /> Evaluate
                          </Button>
                          {app && (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => void showHistory(c)}>
                                <History className="h-4 w-4" /> History
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => app && setAssessApp({ application: app, candidate: c })}>
                                <ClipboardList className="h-4 w-4" /> Assessments
                              </Button>
                            </>
                          )}
                        </div>

                        {app && stage !== "final_round" && stage !== "selected" && stage !== "rejected" && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void runStage(c, "move_forward")} disabled={busyAction === `move_forward-${c.id}`}>
                              Move forward <ArrowRight className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void runStage(c, "reject")} disabled={busyAction === `reject-${c.id}`}>
                              Reject
                            </Button>
                          </div>
                        )}
                        {app && stage === "final_round" && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void runStage(c, "select")} disabled={busyAction === `select-${c.id}`}>
                              Select — convert to employee
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void runStage(c, "reject")} disabled={busyAction === `reject-${c.id}`}>
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fit modal */}
      <Dialog open={!!fit} onOpenChange={(o) => !o && (setFit(null), setFitLineage(null))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Skill Intelligence Graph — fit</DialogTitle>
          </DialogHeader>
          {fit && <FitCard fit={fit} lineage={fitLineage ?? undefined} />}
        </DialogContent>
      </Dialog>

      {/* Kit modal */}
      <Dialog open={!!kit} onOpenChange={(o) => !o && setKit(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Interview kit · {kit?.candidate_name}</DialogTitle>
          </DialogHeader>
          {kit && (
            <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
              <div className="flex items-center gap-3 rounded-lg bg-muted p-4">
                <Star className="h-5 w-5 text-primary" strokeWidth={2.5} />
                <p className="text-sm text-foreground">
                  Fit <span className="font-bold">{Math.round(kit.score * 100)}/100</span> — probes biased to:{" "}
                  <span className="font-bold">{kit.focus_items.join(", ") || "core skills"}</span>
                </p>
              </div>
              {kit.biased_probe && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Candidate-specific probe · {kit.biased_probe.competency}
                  </h3>
                  <div className="mt-2 rounded-md bg-muted p-3">
                    <p className="text-sm font-bold text-foreground">{kit.biased_probe.question}</p>
                    {kit.biased_probe.follow_up_probes.map((q, i) => (
                      <p key={i} className="mt-1 text-sm text-muted-foreground">Probe {i + 1}: {q}</p>
                    ))}
                  </div>
                </div>
              )}
              {kit.competencies.map((comp) => (
                <div key={comp.competency} className="rounded-md bg-muted p-4">
                  <p className="font-bold text-foreground">{comp.competency}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{comp.question}</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {(["tier_1", "tier_2", "tier_3", "tier_4", "tier_5"] as const).map((tier, i) => (
                      <div key={tier} className="flex gap-2 text-xs">
                        <span className="w-36 shrink-0 font-bold uppercase tracking-wide text-primary">Tier {i + 1}</span>
                        <span className="text-muted-foreground">{comp.rubric[tier]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resume modal (file-first ingestion + evidence review; textarea fallback) */}
      <Dialog open={!!resumeTwin} onOpenChange={(o) => !o && (setResumeTwin(null), setResumeMode("file"), setResumeText(""), setExtractResult(null))}>
        <DialogContent className={resumeMode === "file" ? "max-w-5xl" : "max-w-xl"}>
          <DialogHeader>
            <DialogTitle>Resume intake · {resumeTwin?.name}</DialogTitle>
          </DialogHeader>
          {resumeTwin && resumeMode === "file" && (
            <ResumeReviewFlow
              twin={{ id: resumeTwin.id, name: resumeTwin.name }}
              reqId={req?.id}
              onManualImport={() => setResumeMode("text")}
              onSaved={(res) => {
                setExtractResult({ skills: [], years: 0, fit: res.fit?.score ?? null });
                invalidate();
              }}
            />
          )}
          {resumeTwin && resumeMode === "text" && (
            <div className="flex flex-col gap-3">
              <button type="button" onClick={() => setResumeMode("file")} className="text-left text-xs font-semibold text-primary">
                ← Back to file upload (PDF/DOCX preferred)
              </button>
              <Textarea
                rows={6}
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Fallback: paste the resume text. It is treated as untrusted input — instruction-like phrases are neutralized before any model call."
              />
              <Button onClick={() => void runExtract()} disabled={extractBusy}>
                {extractBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Extract skills (text fallback)
              </Button>
              {extractResult && (
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Extracted</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {extractResult.skills.length > 0 ? extractResult.skills.join(", ") : "Review saved as extracted claims — open the Skill Graph fit card for the refreshed match."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {extractResult.years > 0 && `${extractResult.years} years experience · `}
                    deterministic match score: {extractResult.fit !== null ? `${Math.round(extractResult.fit * 100)}/100` : "—"}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Evaluate modal */}
      <Dialog open={!!evalTwin} onOpenChange={(o) => !o && setEvalTwin(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Structured evaluation · {evalTwin?.name}</DialogTitle>
          </DialogHeader>
          {evalTwin && (
            <div className="flex flex-col gap-3">
              <Textarea
                rows={5}
                value={evalNotes}
                onChange={(e) => setEvalNotes(e.target.value)}
                placeholder="Paste interview notes / transcript. Evaluated against the 5-tier rubric."
              />
              <Button onClick={() => void runEvaluate()} disabled={evalBusy}>
                {evalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessagesSquare className="h-4 w-4" />}
                Evaluate
              </Button>
              {evalRes && (
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recommendation</p>
                  <p className="mt-1 text-lg font-extrabold text-foreground">{evalRes.overall_recommendation}</p>
                  <ul className="mt-2 flex flex-col divide-y divide-border">
                    {evalRes.evaluations.map((e) => (
                      <li key={e.competency} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                        <span className="font-semibold text-foreground">{e.competency}</span>
                        <span className="text-muted-foreground">{e.tier} · {e.score}/5</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">{evalRes.summary}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stage transition history */}
      <Dialog open={!!historyApp} onOpenChange={(o) => !o && setHistoryApp(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Application history · {historyApp?.application_code}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {historyBusy && (
              <div className="flex items-center gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {!historyBusy && historyEvents.length === 0 && (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                No transitions yet — the application is at{" "}
                <b className="text-foreground">{historyApp?.stage.replace(/_/g, " ")}</b> (v{historyApp?.version}).
              </p>
            )}
            {historyEvents.map((e) => (
              <div key={e.id} className="rounded-lg bg-muted p-4">
                <p className="text-sm font-bold text-foreground">
                  {e.prior_stage.replace(/_/g, " ")} → {e.new_stage.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString()} · v{e.version}
                </p>
                {e.reason && <p className="mt-1 text-sm text-muted-foreground">{e.reason}</p>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Assessment sessions + reviewer evaluation */}
      {assessApp && (
        <AssessmentReviewPanel
          open={!!assessApp}
          onOpenChange={(o) => !o && setAssessApp(null)}
          application={assessApp.application}
          candidate={{ id: assessApp.candidate.id, name: assessApp.candidate.name, email: assessApp.candidate.email }}
          reqId={req?.id ?? ""}
          reqTitle={req?.title ?? ""}
          onChanged={invalidate}
        />
      )}
    </AppShell>
  );
}
