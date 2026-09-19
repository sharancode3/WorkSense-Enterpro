import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Briefcase,
  FileText,
  Lock,
  Plus,
  UserRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RequisitionForm } from "@/components/requisition-form";
import { CandidateDetail } from "@/components/candidate-detail";
import { CandidateCompareTable } from "@/components/candidate-compare-table";
import { AssessmentWorkQueue } from "@/components/assessment-work-queue";
import { can } from "@/lib/rbac";
import { ApiError, candidateCompare, fetchModelJob, type ApplicationRow } from "@/lib/api";
import {
  decode,
  candidateRowSchema,
  requisitionRowSchema,
  type CandidateCompare,
  type CandidateRow,
  type RequisitionRow,
} from "@/lib/contracts";
import { classifyQuery } from "@/lib/query-state";

const REQ_STATUS_CLASS: Record<string, string> = {
  open: "bg-primary text-white",
  on_hold: "bg-accent text-foreground",
  filled: "bg-secondary text-white",
  closed: "bg-muted text-foreground",
};

// Batch B3: understandable hiring terminology, explained once via tooltip.
const REQ_STATUS_LABEL: Record<string, string> = {
  open: "Open — accepting candidates",
  on_hold: "On hold — hiring temporarily paused",
  filled: "Filled — position staffed",
  closed: "Closed — no longer accepting candidates",
};

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

function CriteriaChips({ req }: { req: RequisitionRow }) {
  const criteria = req.requisition_criteria;
  if (criteria.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {criteria.map((c) => (
        <span
          key={c.skill}
          title={c.evidence_expectation}
          className={`rounded-md px-2 py-1 text-xs font-semibold ${
            c.requirement === "required" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {c.skill} · {c.target_proficiency}
          <span className="ml-1 font-bold opacity-80">w{c.weight}</span>
          <span className="ml-1 lowercase">{c.requirement}</span>
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
  const [selected, setSelected] = useState<string>(searchParams.get("req") ?? "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") === "work-queue" ? "work-queue" : "pipeline");
  const [detailCandidate, setDetailCandidate] = useState<CandidateRow | null>(null);
  const [detailReq, setDetailReq] = useState<RequisitionRow | null>(null);
  const [detailApp, setDetailApp] = useState<ApplicationRow | null>(null);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);

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

  const reqs = useQuery({
    queryKey: ["recruiter-reqs", user?.id ?? "anon"],
    queryFn: async () => {
      const { data, error } = await supabase.from("job_requisitions").select("*").order("created_at", { ascending: false });
      if (error) throw new ApiError(error.message, error.code);
      return (data ?? []).map((r) => decode(requisitionRowSchema, r, "requisition-row"));
    },
  });

  const apps = useQuery({
    queryKey: ["recruiter-apps", selected, user?.id ?? "anon"],
    queryFn: async () => {
      if (!selected) return { apps: [], events: [] };
      const { data: rows } = await supabase
        .from("applications")
        .select("*")
        .eq("requisition_id", selected)
        .order("applied_at");
      return { apps: (rows ?? []) as ApplicationRow[] };
    },
  });

  const candidates = useQuery({
    queryKey: ["recruiter-candidates", user?.id ?? "anon"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("digital_twins")
        .select("id, name, email, role, status")
        .eq("role", "candidate")
        .order("name");
      if (error) throw new ApiError(error.message, error.code);
      return (data ?? []).map((c) => decode(candidateRowSchema, c, "candidate-row"));
    },
  });

  const compare = useQuery({
    queryKey: ["recruiter-compare", selected, user?.id ?? "anon"],
    queryFn: async () => {
      if (!selected) return { ok: true as const, req_id: "", req_title: "", criteria: [], rows: [], scored_count: 0, unscored_count: 0, stale_count: 0 };
      return candidateCompare(selected);
    },
    enabled: !!selected,
  });

  const reqsState = classifyQuery<RequisitionRow[]>({
    isPending: reqs.isPending,
    isError: reqs.isError,
    data: reqs.data,
    error: reqs.error,
    list: true,
  });
  const compareState = classifyQuery<CandidateCompare>({
    isPending: compare.isPending,
    isError: compare.isError,
    data: compare.data,
    error: compare.error,
    list: false,
  });

  const candidatesMap = new Map((candidates.data ?? []).map((c) => [c.id, c]));
  const req = reqs.data?.find((r) => r.id === selected) ?? null;
  const appsByTwin = new Map((apps.data?.apps ?? []).map((a) => [a.candidate_twin_id, a]));
  const visibleReqs = (reqs.data ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter);

  // ?cand=<twin_id> deep-links straight into a candidate workspace (used by the
  // "My work" feed and shareable links). Opens once requisitions/candidates load.
  const candParam = searchParams.get("cand");
  const [openedCandParam, setOpenedCandParam] = useState<string | null>(null);
  useEffect(() => {
    if (!candParam || openedCandParam === candParam) return;
    const c = candidates.data?.find((x) => x.id === candParam);
    if (!c) return;
    setOpenedCandParam(candParam);
    const targetReq = selected && reqs.data?.find((r) => r.id === selected) ? selected : (reqs.data ?? []).find((r) => r.applicants.some((a) => a.twin_id === candParam))?.id;
    if (targetReq && targetReq !== selected) setSelected(targetReq);
    const r = reqs.data?.find((x) => x.id === (targetReq ?? selected)) ?? null;
    if (!r) return;
    setDetailCandidate(c);
    setDetailReq(r);
    setDetailApp(apps.data?.apps.find((a) => a.candidate_twin_id === c.id) ?? null);
  }, [candParam, openedCandParam, candidates.data, reqs.data, selected, apps.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["recruiter-reqs", user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["recruiter-candidates", user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["recruiter-apps", selected, user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["recruiter-compare", selected, user?.id ?? "anon"] });
  };

  const openCandidate = (twinId: string) => {
    const c = candidatesMap.get(twinId);
    if (!c || !req) return;
    setDetailCandidate(c);
    setDetailReq(req);
    setDetailApp(appsByTwin.get(twinId) ?? null);
    setFocusSessionId(null);
  };

  // Batch 5 (5.2): a work-queue row deep-links into the candidate workspace
  // with the Assessments tab open on the relevant session.
  const openQueueSession = (twinId: string, applicationId: string, sessionId: string, requisitionId: string) => {
    const c = candidatesMap.get(twinId);
    const r = reqs.data?.find((x) => x.id === requisitionId) ?? null;
    if (!c || !r) return;
    void supabase
      .from("applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle()
      .then(({ data }) => {
        setDetailCandidate(c);
        setDetailReq(r);
        setDetailApp((data as ApplicationRow | null) ?? null);
        setFocusSessionId(sessionId);
      });
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

  const pipelineStats = (() => {
    const counts: Record<string, number> = {};
    for (const a of req?.applicants ?? []) counts[a.stage] = (counts[a.stage] ?? 0) + 1;
    return counts;
  })();

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Recruitment & Interview Studio</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">Recruitment workspace</h1>
          <p className="max-w-2xl text-muted-foreground">
            Weighted criteria, a candidate comparison that never ranks unknowns as zero, and a per-candidate workspace
            for resumes, fit, interviews and history. Selection stays a human decision.
          </p>
        </div>

        {recoveredJob && (
          <div className="mt-6 flex items-center gap-3 rounded-lg bg-muted p-4 text-sm">
            <span className="font-bold text-foreground">Recovered job #{recoveredJob.id.slice(0, 8)}</span>
            <span className="text-muted-foreground">
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
              className="ml-auto text-xs font-semibold text-primary"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left rail: requisitions */}
          <div className="flex flex-col gap-4">
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Create hiring role
            </Button>
            <div className="flex flex-wrap gap-1.5">
              {["all", "open", "on_hold", "filled", "closed"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider transition-colors ${
                    statusFilter === s ? "bg-foreground text-white" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s === "all" ? `All (${(reqs.data ?? []).length})` : s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {reqsState.kind === "loading" && (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Loading requisitions…</p>
              )}
              {reqsState.kind === "unavailable" && (
                <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                  Could not reach the backend — check your connection and try again.
                </p>
              )}
              {reqsState.kind === "error" && (
                <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{reqsState.message}</p>
              )}
              {reqsState.kind === "empty" && (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No requisitions yet.</p>
              )}
              {reqsState.kind === "ready" &&
                visibleReqs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelected(r.id);
                      setActiveTab("pipeline");
                    }}
                    className={`flex items-center justify-between gap-2 rounded-lg p-4 text-left transition-all duration-200 ${
                      selected === r.id ? "bg-foreground text-white" : "bg-white text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-bold">
                      <Briefcase className="h-4 w-4 shrink-0" />
                      <span className="truncate">{r.title}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${selected === r.id ? "bg-white/20 text-white" : REQ_STATUS_CLASS[r.status] ?? "bg-muted text-foreground"}`}>
                        {r.status.replace(/_/g, " ")}
                      </span>
                      <span className={`text-xs ${selected === r.id ? "text-white/70" : "text-muted-foreground"}`}>
                        {r.applicants.length}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          </div>

          {/* Main: requisition workspace */}
          <div className="lg:col-span-2">
            {!req ? (
              activeTab === "work-queue" ? (
                <AssessmentWorkQueue
                  requisitionId=""
                  requisitionTitle=""
                  onOpenSession={openQueueSession}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-20 text-center">
                  <Briefcase className="h-8 w-8 text-primary" strokeWidth={2.5} />
                  <p className="text-sm text-muted-foreground">Select a requisition to open its workspace.</p>
                </div>
              )
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-lg bg-white p-5">
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
                        {req.applicants.filter((a) => a.stage !== "rejected").length} in pipeline
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Criteria</span>
                    <CriteriaChips req={req} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {(["screening", "technical_interview", "final_round", "selected", "rejected"] as const).map((s) => (
                      <div key={s} className="min-w-0 rounded-lg bg-muted p-2 text-center">
                        <p className="text-lg font-extrabold text-foreground">{pipelineStats[s] ?? 0}</p>
                        <p
                          className={`text-[10px] font-bold uppercase leading-tight tracking-wide ${s === "rejected" ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {STAGE_LABEL[s]}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList>
                    <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
                    <TabsTrigger value="compare">
                      Compare
                      {compare.data && (compare.data.scored_count > 0 || compare.data.unscored_count > 0) && (
                        <span className="ml-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {compare.data.scored_count + compare.data.unscored_count + compare.data.stale_count}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="work-queue">Work queue</TabsTrigger>
                  </TabsList>

                  <TabsContent value="pipeline" className="flex flex-col gap-3">
                    {req.applicants.filter((a) => a.stage !== "rejected" && a.stage !== "selected").length === 0 && (
                      <div className="flex items-center gap-3 rounded-lg bg-muted p-6 text-sm text-muted-foreground">
                        <FileText className="h-5 w-5" /> No active applicants in this pipeline.
                      </div>
                    )}
                    {req.applicants
                      .filter((a) => a.stage !== "rejected" && a.stage !== "selected")
                      .map((a) => {
                        const c = candidatesMap.get(a.twin_id);
                        if (!c) return null;
                        const app = appsByTwin.get(a.twin_id);
                        const stage = app?.stage ?? a.stage;
                        return (
                          <button
                            key={a.twin_id}
                            type="button"
                            onClick={() => openCandidate(a.twin_id)}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-5 text-left transition-all duration-200 hover:bg-muted/60"
                          >
                            <span className="flex items-center gap-3">
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                                <UserRound className="h-5 w-5" />
                              </span>
                              <span>
                                <span className="block font-bold text-foreground">{c.name}</span>
                                <span className="block text-xs text-muted-foreground">{c.email}</span>
                              </span>
                            </span>
                            <span className="flex items-center gap-2">
                              {app && (
                                <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                                  v{app.version}
                                </span>
                              )}
                              <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${STAGE_CLASS[stage] ?? "bg-muted text-foreground"}`}>
                                {STAGE_LABEL[stage] ?? stage.replace(/_/g, " ")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {app ? new Date(app.applied_at).toLocaleDateString() : "—"}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                  </TabsContent>

                  <TabsContent value="compare">
                    {compare.data ? (
                      <CandidateCompareTable
                        compare={compare.data}
                        state={compareState}
                        onOpenCandidate={openCandidate}
                        onShowFit={(twinId) => openCandidate(twinId)}
                      />
                    ) : (
                      <div className="rounded-lg bg-muted p-6 text-sm text-muted-foreground">
                        Computing candidate comparison…
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="overview" className="flex flex-col gap-3">
                    <div className="rounded-lg bg-white p-5 text-sm text-muted-foreground">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">How decisions stay honest</p>
                      <ul className="mt-2 flex flex-col gap-1.5 text-sm text-foreground/80">
                        <li>• Match scores are deterministic distances over the skill graph — never probabilities, never LLM judgment.</li>
                        <li>• Unknown scores are never ranked as zero: unscored candidates sit in their own bucket until a Fit card is computed.</li>
                        <li>• Interview kits bias probes toward each candidate's adjacent/transferable/gap items, with cached per-role rubrics.</li>
                        <li>• "Select" requires a human action in the final round — model output can recommend, never decide.</li>
                      </ul>
                    </div>
                    <div className="rounded-lg bg-white p-5">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Weighted criteria</p>
                      <div className="mt-2 flex flex-col gap-2">
                        {req.requisition_criteria.length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            No weighted criteria yet — create them on a new requisition or update this one.
                          </p>
                        )}
                        {req.requisition_criteria.map((c) => (
                          <div key={c.skill} className="flex flex-col gap-1 rounded-lg bg-muted p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-foreground">{c.skill}</span>
                              <Badge variant="outline">proficiency {c.target_proficiency}</Badge>
                              <Badge variant={c.requirement === "required" ? "default" : "secondary"}>{c.requirement}</Badge>
                              <span className="font-mono text-xs text-muted-foreground">weight {c.weight}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{c.evidence_expectation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="work-queue" className="flex flex-col gap-3">
                    <AssessmentWorkQueue
                      requisitionId={selected}
                      requisitionTitle={req.title}
                      onOpenSession={openQueueSession}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Candidate workspace */}
      {detailCandidate && detailReq && (
        <CandidateDetail
          open={!!detailCandidate}
          onOpenChange={(o) => {
            if (!o) {
              setDetailCandidate(null);
              setDetailReq(null);
              setDetailApp(null);
              setFocusSessionId(null);
            }
          }}
          candidate={detailCandidate}
          req={detailReq}
          app={detailApp}
          initialSessionId={focusSessionId}
          onChanged={invalidate}
        />
      )}

      {/* Create-requisition drawer */}
      <RequisitionForm open={creating} onOpenChange={setCreating} onCreated={invalidate} />
    </AppShell>
  );
}
