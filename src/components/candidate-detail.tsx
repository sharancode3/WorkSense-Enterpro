import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  Download,
  ExternalLink,
  FileText,
  History,
  Loader2,
  MessagesSquare,
  RefreshCw,
  ShieldCheck,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FitCard } from "@/components/fit-card";
import { useAuth } from "@/contexts/auth-context";
import { ResumeReviewFlow } from "@/components/resume-review-flow";
import { AssessmentReviewPanel } from "@/components/assessment-review-panel";
import { classifyQuery } from "@/lib/query-state";
import {
  loadCandidateSessions,
  SESSION_STATUS_LABEL,
  SESSION_TYPE_LABEL,
  type CandidateSessionSummary,
} from "@/lib/candidate-sessions";
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
  generateInterviewKit,
  generateRubrics,
  resumeDownload,
  type ApplicationRow,
  type InterviewEvaluation,
  type InterviewKit,
  type StageEventRow,
} from "@/lib/api";
import type { CandidateRow, RequisitionRow } from "@/lib/contracts";

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

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidate: CandidateRow;
  req: RequisitionRow | null;
  app: ApplicationRow | null;
  /** Batch 5 (5.2): open the Assessments tab and review this session directly. */
  initialSessionId?: string | null;
  onChanged: () => void;
}

export function CandidateDetail({ open, onOpenChange, candidate, req, app, initialSessionId, onChanged }: Props) {
  const qc = useQueryClient();
  const { role } = useAuth();
  // Resume intake (upload / replace / extract) is a recruitment action. Other
  // review roles (administrator, HR) see the document and can download it, but
  // are not offered an upload control.
  const canManageResume = role === "recruiter";
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState("profile");

  // Fit
  const [fit, setFit] = useState<FitRecord | null>(null);
  const [fitLineage, setFitLineage] = useState<FitLineage | null>(null);
  // Kit + evaluate
  const [kit, setKit] = useState<InterviewKit | null>(null);
  const [evalRes, setEvalRes] = useState<InterviewEvaluation | null>(null);
  const [evalNotes, setEvalNotes] = useState("");
  const [evalBusy, setEvalBusy] = useState(false);
  // History
  const [events, setEvents] = useState<StageEventRow[] | null>(null);
  const [assessOpen, setAssessOpen] = useState(false);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  // Resume provenance
  const [provenance, setProvenance] = useState<{ document_id: string; version: number; artifact_ref: string; file_name: string; checksum_short: string } | null>(null);
  const [resumeMode, setResumeMode] = useState<"file" | "text">("file");
  const [pendingDecision, setPendingDecision] = useState<"reject" | "select" | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractResult, setExtractResult] = useState<{ skills: string[]; years: number; fit: number | null } | null>(null);

  const resumeDocuments = useQuery({
    queryKey: ["candidate-resume-docs", candidate.id],
    queryFn: async () => {
      const { data: docs } = await supabase
        .from("resume_documents")
        .select("id, file_name, status, page_count, checksum, created_at, low_text, extracted_text")
        .eq("twin_id", candidate.id)
        .order("created_at", { ascending: false });
      const { data: versions } = await supabase
        .from("resume_versions")
        .select("id, document_id, version, review_state, reviewed_at, created_at")
        .eq("twin_id", candidate.id)
        .order("version", { ascending: false });
      return {
        documents: (docs ?? []) as { id: string; file_name: string; status: string; page_count: number | null; checksum: string; created_at: string; low_text: boolean; extracted_text: string | null }[],
        versions: (versions ?? []) as { id: string; document_id: string; version: number; review_state: string; reviewed_at: string | null; created_at: string }[],
      };
    },
    enabled: open,
  });

  // Batch 5 (5.1/5.3): the Assessments tab renders REAL session rows with
  // explicit query states — a failed read is an error with retry, never a
  // false "no assessments". Loaded when either the Assessments or Interview
  // tab (interview record) needs it.
  const sessionsQuery = useQuery({
    queryKey: ["candidate-sessions", app?.id ?? "none"],
    queryFn: () => loadCandidateSessions(app!.id),
    enabled: open && !!app && (tab === "assessments" || tab === "interview"),
  });

  // Batch 5 (5.2): deep-link from the hiring work queue — open the Assessments
  // tab and launch the reviewer on the requested session.
  useEffect(() => {
    if (open && app && initialSessionId) {
      setTab("assessments");
      setFocusSessionId(initialSessionId);
      setAssessOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSessionId, app?.id]);

  useEffect(() => {
    if (!open) {
      setTab("profile");
      setFit(null);
      setFitLineage(null);
      setKit(null);
      setEvalRes(null);
      setEvalNotes("");
      setEvents(null);
      setProvenance(null);
      setExtractResult(null);
      setResumeMode("file");
      setResumeText("");
      setAssessOpen(false);
      setFocusSessionId(null);
      void qc.invalidateQueries({ queryKey: ["candidate-resume-docs", candidate.id] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Batch A1: never show one candidate's cached fit/kit/resume beneath another
  // name — switching candidates while the detail is open resets identity state.
  useEffect(() => {
    setTab("profile");
    setFit(null);
    setFitLineage(null);
    setKit(null);
    setEvalRes(null);
    setEvalNotes("");
    setEvents(null);
    setProvenance(null);
    setExtractResult(null);
    setResumeMode("file");
    setResumeText("");
    setAssessOpen(false);
    setFocusSessionId(null);
    void qc.invalidateQueries({ queryKey: ["candidate-resume-docs", candidate.id] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id]);

  const runStage = async (decision: "move_forward" | "reject" | "select") => {
    if (!app) return;
    setBusy(`${decision}-${candidate.id}`);
    try {
      const res = await applicationStage(app.id, decision, app.stage, app.version, decision === "select" ? "Selected by recruiter." : undefined);
      toast.success(
        decision === "select"
          ? `${candidate.name} converted to employee — pre-hire data preserved.`
          : `${candidate.name}: ${res.reason ?? "Stage updated."}`
      );
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STALE_STATE") {
        toast.error(err.message);
        onChanged();
      } else {
        toast.error(err instanceof Error ? err.message : "Decision failed");
      }
    } finally {
      setBusy(null);
    }
  };

  const loadHistory = async () => {
    if (!app || events) return;
    try {
      const { data } = await supabase
        .from("application_stage_events")
        .select("id, application_id, prior_stage, new_stage, reason, at, version, actor_twin_id")
        .eq("application_id", app.id)
        .order("at", { ascending: true });
      setEvents((data ?? []) as StageEventRow[]);
    } catch {
      toast.error("Could not load transition history.");
      setEvents([]);
    }
  };

  const showFit = async () => {
    if (!req) return;
    setBusy(`fit-${candidate.id}`);
    setFit(null);
    setFitLineage(null);
    try {
      const res = await computeSkillFit({ twin_id: candidate.id, target_id: req.id, scenario: "current" });
      setFit(res.fit);
      setFitLineage(res.lineage ?? null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fit failed");
    } finally {
      setBusy(null);
    }
  };

  const showKit = async () => {
    if (!req) return;
    setBusy(`kit-${candidate.id}`);
    setKit(null);
    try {
      const cached = new Set((req.rubrics ?? []).map((r) => ((r as { competency?: string }).competency ?? "").toLowerCase()));
      const missing = [...req.required_skills.map((s) => s.skill), "Collaboration"].filter((c) => !cached.has(c.toLowerCase()));
      // Warm rubrics one competency per call (local model is most reliable at
      // single-competency granularity; cached per role so repeat kits are fast).
      for (const comp of missing) {
        try {
          await generateRubrics(req.id, [comp]);
        } catch (err) {
          toast.error(
            `Rubric generation for "${comp}" failed — ${err instanceof Error ? err.message : "unknown"}. Rubrics must be valid before an interview kit can be built.`
          );
          setBusy(null);
          return;
        }
      }
      const res = await generateInterviewKit(candidate.id, req.id);
      setKit(res.kit);
      toast.success(`Interview kit ready — probes biased to ${res.kit.focus_items.join(", ") || "core skills"}.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kit failed");
    } finally {
      setBusy(null);
    }
  };

  const runExtract = async () => {
    if (!req) return;
    if (resumeText.trim().length < 20) {
      toast.error("Paste at least 20 characters of resume.");
      return;
    }
    setExtractBusy(true);
    setExtractResult(null);
    try {
      const res = await extractResume(candidate.id, resumeText, req.id);
      setExtractResult({
        skills: res.extracted_skills.map((s) => s.name),
        years: res.years_experience ?? 0,
        fit: res.fit?.score ?? null,
      });
      toast.success("Resume extracted — structured skills persisted; match computed by the deterministic engine.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtractBusy(false);
    }
  };

  const runEvaluate = async () => {
    if (!req) return;
    if (evalNotes.trim().length < 10) {
      toast.error("Add interview notes first.");
      return;
    }
    setEvalBusy(true);
    setEvalRes(null);
    try {
      const res = await evaluateInterview(candidate.id, req.id, evalNotes);
      setEvalRes(res.evaluation);
      toast.success("Structured evaluation recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setEvalBusy(false);
    }
  };

  const stage = app?.stage ?? "screening";

  const sessionsState = classifyQuery<CandidateSessionSummary[]>({
    isPending: sessionsQuery.isPending,
    isError: sessionsQuery.isError,
    data: sessionsQuery.data,
    error: sessionsQuery.error,
    list: true,
  });

  const interviewSessions = sessionsState.kind === "ready" ? sessionsState.data.filter((s) => s.session_type === "interview") : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-4xl max-h-[calc(100dvh-2rem)] flex-col p-0">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle className="flex flex-wrap items-center gap-3">
            <span>{candidate.name}</span>
            <span className="text-sm font-medium text-muted-foreground">{candidate.email}</span>
            {app && (
              <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${STAGE_CLASS[stage] ?? "bg-muted text-foreground"}`}>
                {STAGE_LABEL[stage] ?? stage.replace(/_/g, " ")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Bounded scrollable body: header + tabs stay, content scrolls, footer
            (close/actions) stays reachable on small screens. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            // Batch 5 (5.1): no auto-launched dialog. The Assessments tab
            // renders real session rows in place; the reviewer opens on demand.
            setTab(v);
          }}
        >
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="resume">Resume</TabsTrigger>
            <TabsTrigger value="fit">Fit</TabsTrigger>
            <TabsTrigger value="interview">Interview</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            {app && <TabsTrigger value="assessments">Assessments</TabsTrigger>}
          </TabsList>

          {/* Profile + stage controls */}
          <TabsContent value="profile" className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Application</p>
                <p className="mt-1 font-mono text-foreground">{app?.application_code ?? "—"}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Applied {app ? new Date(app.applied_at).toLocaleDateString() : "—"} · v{app?.version ?? 1}
                </p>
              </div>
              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Requisition</p>
                <p className="mt-1 font-bold text-foreground">{req?.title ?? "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{req?.department} · Seniority {req?.seniority_level}</p>
              </div>
            </div>

            {app && stage !== "final_round" && stage !== "selected" && stage !== "rejected" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 p-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stage decision</span>
                <Button size="sm" onClick={() => void runStage("move_forward")} disabled={busy === `move_forward-${candidate.id}`}>
                  {busy === `move_forward-${candidate.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Move forward
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPendingDecision("reject")} disabled={busy === `reject-${candidate.id}`}>
                  Reject
                </Button>
              </div>
            )}
            {app && stage === "final_round" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 p-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Decision</span>
                <Button size="sm" onClick={() => setPendingDecision("select")} disabled={busy === `select-${candidate.id}`}>
                  {busy === `select-${candidate.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Select — convert to employee
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPendingDecision("reject")} disabled={busy === `reject-${candidate.id}`}>
                  Reject
                </Button>
                <p className="ml-auto text-[11px] text-muted-foreground">Selection is human-only — model output never changes it.</p>
              </div>
            )}
          </TabsContent>

          {/* Resume: existing document first (viewing), intake as a secondary,
              permission-controlled action (Batch B1). */}
          <TabsContent value="resume" className="flex flex-col gap-4">
            {resumeDocuments.isLoading ? (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Loading resume documents…</p>
            ) : resumeDocuments.isError ? (
              <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                Could not load resume documents — the record may be unavailable.
              </p>
            ) : (resumeDocuments.data?.documents?.length ?? 0) > 0 ? (
              <div className="rounded-lg bg-muted p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <FileText className="h-4 w-4" /> Existing resume document
                  </p>
                  <span className="rounded-md bg-foreground px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                    {resumeDocuments.data?.documents?.[0]?.file_name}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Uploaded {resumeDocuments.data?.documents?.[0]?.created_at ? new Date(resumeDocuments.data.documents[0].created_at).toLocaleDateString() : "—"}
                  {resumeDocuments.data?.documents?.[0]?.low_text ? " · extracted text preview (low-text document)" : " · text-extracted"}
                  {resumeDocuments.data?.versions?.[0] ? ` · v${resumeDocuments.data.versions[0].version} ${resumeDocuments.data.versions[0].review_state ?? ""}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" asChild>
                    <a
                      href={`/api/resume-download?id=${resumeDocuments.data?.documents?.[0]?.id ?? ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        void resumeDownload(resumeDocuments.data?.documents?.[0]?.id ?? "").then((r) => {
                          if (r.url) window.open(r.url, "_blank", "noopener,noreferrer");
                        });
                      }}
                    >
                      <Download className="h-4 w-4" /> Download
                    </a>
                  </Button>
                  {canManageResume && (
                    <Button size="sm" variant="ghost" onClick={() => setResumeMode("text")}>
                      Import / replace document
                    </Button>
                  )}
                </div>
                {/* Inline resume text preview — viewing never depends on a file
                    download opening in the right app. */}
                {resumeDocuments.data?.documents?.[0]?.extracted_text && (
                  <details className="mt-3 rounded-md border border-border bg-white">
                    <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                      <FileText className="h-3.5 w-3.5" /> View resume text
                    </summary>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 pt-1 font-sans text-xs leading-relaxed text-foreground">
                      {resumeDocuments.data.documents[0].extracted_text}
                    </pre>
                  </details>
                )}
                {!canManageResume && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    View-only — resume intake (upload / replace / extract) is a recruiter action.
                  </p>
                )}
                {(resumeDocuments.data?.documents?.length ?? 0) > 1 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {resumeDocuments.data?.documents?.length} document(s) · {resumeDocuments.data?.versions?.length ?? 0} version(s) on record.
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                No resume document on record for this candidate yet — import one below.
              </p>
            )}
            {canManageResume && (
              <>
                <ResumeReviewFlow
                  twin={{ id: candidate.id, name: candidate.name }}
                  reqId={req?.id}
                  onManualImport={() => setResumeMode("text")}
                  onSaved={(res) => {
                    setProvenance({
                      document_id: res.document_id,
                      version: res.version,
                      artifact_ref: res.provenance?.artifact_ref ?? `doc:${res.document_id}:v${res.version}`,
                      file_name: res.provenance?.file_name ?? "resume document",
                      checksum_short: res.provenance?.checksum_short ?? "…",
                    });
                    onChanged();
                  }}
                />
                {provenance && (
                  <div className="rounded-lg border-2 border-secondary/40 bg-secondary/5 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-secondary">
                      <ShieldCheck className="h-3.5 w-3.5" /> Evidence provenance
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
                      <div>
                        <p className="text-[11px] text-muted-foreground">Source artifact</p>
                        <p className="font-mono text-xs font-semibold text-foreground">{provenance.artifact_ref}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground">File</p>
                        <p className="font-mono text-xs text-foreground">{provenance.file_name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground">Checksum</p>
                        <p className="font-mono text-xs text-foreground">{provenance.checksum_short}…</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Every claim quote was validated against the stored source text before saving — fabricated quotes are
                      rejected server-side.
                    </p>
                  </div>
                )}
                {resumeMode === "text" && (
                  <div className="flex flex-col gap-3">
                    <Textarea
                      rows={5}
                      value={resumeText}
                      onChange={(e) => setResumeText(e.target.value)}
                      placeholder="Fallback: paste the resume text. Treated as untrusted input — instruction-like phrases are neutralized before any model call."
                    />
                    <Button onClick={() => void runExtract()} disabled={extractBusy} className="self-start">
                      {extractBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      Extract skills (text fallback)
                    </Button>
                    {extractResult && (
                      <div className="rounded-lg bg-muted p-4 text-sm">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Extracted</p>
                        <p className="mt-1 text-foreground">
                          {extractResult.skills.length > 0 ? extractResult.skills.join(", ") : "Claims recorded — open Fit for the refreshed match."}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {extractResult.years > 0 && `${extractResult.years} years experience · `}
                          match: {extractResult.fit !== null ? `${Math.round(extractResult.fit * 100)}/100` : "—"}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="rounded-lg bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Revision history</p>
              {resumeDocuments.isPending && (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading documents…
                </p>
              )}
              {(resumeDocuments.data?.documents.length ?? 0) === 0 && !resumeDocuments.isPending && (
                <p className="mt-2 text-sm text-muted-foreground">No resume documents uploaded for this candidate yet.</p>
              )}
              <div className="mt-2 flex flex-col gap-2">
                {resumeDocuments.data?.documents.map((d) => {
                  const docVersions = resumeDocuments.data.versions.filter((v) => v.document_id === d.id);
                  return (
                    <div key={d.id} className="rounded-lg bg-muted p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                          <FileText className="h-4 w-4 text-primary" />
                          {d.file_name}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{d.status.replace(/_/g, " ")}</Badge>
                          <span className="font-mono text-[11px] text-muted-foreground">{d.checksum.slice(0, 10)}…</span>
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {d.page_count ?? "?"} page(s) · uploaded {new Date(d.created_at).toLocaleDateString()}
                      </p>
                      {docVersions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {docVersions.map((v) => (
                            <span key={v.id} className="rounded-md bg-foreground px-2 py-0.5 text-[10px] font-bold text-white">
                              v{v.version} · {v.review_state}
                              {v.reviewed_at ? ` · ${new Date(v.reviewed_at).toLocaleDateString()}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* Fit */}
          <TabsContent value="fit" className="flex flex-col gap-3">
            {!fit ? (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-14 text-center">
                <Target className="h-8 w-8 text-primary" strokeWidth={2.5} />
                <p className="max-w-sm text-sm text-muted-foreground">
                  Compute the deterministic Skill Intelligence Graph match against {req?.title}. The score is never a
                  probability — it is a distance over the graph, and unknown claims are not treated as zero.
                </p>
                <Button onClick={() => void showFit()} disabled={busy === `fit-${candidate.id}`}>
                  {busy === `fit-${candidate.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                  Compute fit
                </Button>
              </div>
            ) : (
              <FitCard fit={fit} lineage={fitLineage ?? undefined} />
            )}
          </TabsContent>

          {/* Interview: record + kit + evaluation */}
          <TabsContent value="interview" className="flex flex-col gap-4">
            {/* Batch 5 (5.6): minimal interview record — real rows, clearly
                labeled manual scheduling. No calendar invite is ever created. */}
            <div className="rounded-lg bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Interview record</p>
                <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Manually scheduled
                </span>
              </div>
              {sessionsState.kind === "loading" && (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sessions…
                </p>
              )}
              {sessionsState.kind === "error" || sessionsState.kind === "unavailable" ? (
                <p className="mt-2 text-sm text-destructive">
                  The interview record could not be loaded right now — open the Assessments tab to retry.
                </p>
              ) : (interviewSessions ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No interview session has been created for this application yet. Interview scheduling is a manual
                  human step — no calendar invite is generated automatically.
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  {interviewSessions?.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3">
                      <div>
                        <p className="text-sm font-bold text-foreground">{s.blueprint_title}</p>
                        <p className="text-xs text-muted-foreground">
                          <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                          {s.status === "submitted" && s.submitted_at
                            ? `Submitted ${new Date(s.submitted_at).toLocaleString()}`
                            : s.status === "expired"
                              ? `Invitation expired ${new Date(s.expires_at).toLocaleDateString()}`
                              : `Invitation open until ${new Date(s.expires_at).toLocaleDateString()}`}
                        </p>
                      </div>
                      <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${s.status === "submitted" ? "bg-secondary text-white" : "bg-accent text-foreground"}`}>
                        {SESSION_STATUS_LABEL[s.status] ?? s.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Time and participants are coordinated manually with the candidate — this system never sends or
                    fabricates calendar invites.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Interview kit</p>
                <Button size="sm" variant="secondary" onClick={() => void showKit()} disabled={busy === `kit-${candidate.id}`}>
                  {busy === `kit-${candidate.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessagesSquare className="h-4 w-4" />}
                  {kit ? "Regenerate kit" : "Generate kit"}
                </Button>
              </div>
              {kit && (
                <div className="mt-3 flex max-h-[40vh] flex-col gap-3 overflow-y-auto pr-1">
                  <div className="flex items-center gap-3 rounded-lg bg-muted p-3 text-sm">
                    <Target className="h-4 w-4 text-primary" strokeWidth={2.5} />
                    <span className="text-foreground">
                      Fit <b>{Math.round(kit.score * 100)}/100</b> — probes biased to:{" "}
                      <b>{kit.focus_items.join(", ") || "core skills"}</b>
                    </span>
                  </div>
                  {kit.biased_probe && (
                    <div className="rounded-md bg-muted p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Candidate-specific probe · {kit.biased_probe.competency}
                      </p>
                      <p className="mt-1 text-sm font-bold text-foreground">{kit.biased_probe.question}</p>
                      {kit.biased_probe.follow_up_probes.map((q, i) => (
                        <p key={i} className="mt-1 text-sm text-muted-foreground">
                          Probe {i + 1}: {q}
                        </p>
                      ))}
                    </div>
                  )}
                  {kit.competencies.map((comp) => (
                    <div key={comp.competency} className="rounded-md bg-muted p-3">
                      <p className="font-bold text-foreground">{comp.competency}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{comp.question}</p>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {(["tier_1", "tier_2", "tier_3", "tier_4", "tier_5"] as const).map((tier, i) => (
                          <div key={tier} className="flex gap-2 text-xs">
                            <span className="w-32 shrink-0 font-bold uppercase tracking-wide text-primary">Tier {i + 1}</span>
                            <span className="text-muted-foreground">{comp.rubric[tier]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Structured evaluation</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Paste interview notes or a transcript. Evaluated against the 5-tier rubric; the recommendation is a draft —
                only a human decision changes the application stage.
              </p>
              <div className="mt-3 flex flex-col gap-3">
                <Textarea
                  rows={4}
                  value={evalNotes}
                  onChange={(e) => setEvalNotes(e.target.value)}
                  placeholder="Interview notes / transcript…"
                />
                <Button size="sm" onClick={() => void runEvaluate()} disabled={evalBusy} className="self-start">
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
                          <span className="text-muted-foreground">
                            {e.tier} · {e.score}/5
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">{evalRes.summary}</p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* History */}
          <TabsContent value="history">
            {!app ? (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No application record for this candidate.</p>
            ) : events === null ? (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-12 text-center">
                <History className="h-7 w-7 text-primary" />
                <Button size="sm" variant="secondary" onClick={() => void loadHistory()}>
                  Load transition history
                </Button>
              </div>
            ) : events.length === 0 ? (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                No transitions yet — the application is at <b className="text-foreground">{stage.replace(/_/g, " ")}</b> (v
                {app.version}).
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {events.map((e) => (
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
            )}
          </TabsContent>

          {/* Assessments: real session rows with explicit query states — a
              failed read is an error with retry, never a false empty tab. */}
          {app && (
            <TabsContent value="assessments" className="flex flex-col gap-3">
              {sessionsState.kind === "loading" && (
                <p className="flex items-center gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading assessment and interview sessions…
                </p>
              )}
              {sessionsState.kind === "unavailable" && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                  <p className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4" /> Could not reach the backend — sessions are unavailable right now.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => void sessionsQuery.refetch()}>
                    <RefreshCw className="h-4 w-4" /> Retry
                  </Button>
                </div>
              )}
              {sessionsState.kind === "forbidden" && (
                <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                  You are not allowed to read this candidate's assessment sessions.
                </p>
              )}
              {sessionsState.kind === "error" && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                  <p className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4" /> {sessionsState.message}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => void sessionsQuery.refetch()}>
                    <RefreshCw className="h-4 w-4" /> Retry
                  </Button>
                </div>
              )}
              {sessionsState.kind === "empty" && (
                <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-12 text-center">
                  <Briefcase className="h-7 w-7 text-primary" />
                  <p className="max-w-md text-sm text-muted-foreground">
                    No assessment or interview sessions exist for this application yet. Open the reviewer to create
                    invitations (work sample, interview or knowledge assessment).
                  </p>
                  <Button size="sm" variant="secondary" onClick={() => setAssessOpen(true)}>
                    <MessagesSquare className="h-4 w-4" /> Open assessment reviewer
                  </Button>
                </div>
              )}
              {sessionsState.kind === "ready" && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {sessionsState.data.length} session(s) on record
                    </p>
                    <Button size="sm" variant="secondary" onClick={() => setAssessOpen(true)}>
                      <MessagesSquare className="h-4 w-4" /> Open reviewer
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {sessionsState.data.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-4">
                        <div className="min-w-0">
                          <p className="font-bold text-foreground">{s.blueprint_title}</p>
                          <p className="text-xs text-muted-foreground">
                            {SESSION_TYPE_LABEL[s.session_type] ?? s.session_type.replace(/_/g, " ")}
                            {s.status === "submitted" && s.submitted_at
                              ? ` · submitted ${new Date(s.submitted_at).toLocaleString()}`
                              : s.status === "expired"
                                ? ` · expired ${new Date(s.expires_at).toLocaleDateString()}`
                                : s.status === "invited" || s.status === "in_progress"
                                  ? ` · open until ${new Date(s.expires_at).toLocaleDateString()}`
                                  : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                              s.status === "submitted"
                                ? "bg-secondary text-white"
                                : s.status === "expired" || s.status === "cancelled"
                                  ? "bg-muted text-muted-foreground"
                                  : s.status === "in_progress"
                                    ? "bg-primary text-white"
                                    : "bg-accent text-foreground"
                            }`}
                          >
                            {SESSION_STATUS_LABEL[s.status] ?? s.status.replace(/_/g, " ")}
                          </span>
                          <Button size="sm" variant="outline" onClick={() => { setFocusSessionId(s.id); setAssessOpen(true); }}>
                            <ExternalLink className="h-3.5 w-3.5" /> Review
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          )}
        </Tabs>
        </div>
        {app && (
          <AssessmentReviewPanel
            open={assessOpen}
            onOpenChange={(o) => {
              setAssessOpen(o);
              if (!o) setFocusSessionId(null);
            }}
            application={app}
            candidate={{ id: candidate.id, name: candidate.name, email: candidate.email ?? "" }}
            reqId={req?.id ?? ""}
            reqTitle={req?.title ?? ""}
            initialSessionId={focusSessionId ?? undefined}
            onChanged={() => {
              void sessionsQuery.refetch();
              onChanged();
            }}
          />
        )}
        {pendingDecision && app && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="decision-preview-title" className="w-full max-w-md rounded-lg bg-white p-6">
              <h2 id="decision-preview-title" className="text-lg font-extrabold text-foreground">Confirm stage decision</h2>
              <dl className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Candidate</dt><dd className="font-bold text-foreground">{candidate.name}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Role</dt><dd className="font-bold text-foreground">{req?.title ?? "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Current stage</dt><dd className="capitalize text-foreground">{app.stage.replace(/_/g, " ")}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">New stage</dt><dd className="capitalize text-foreground">{pendingDecision === "reject" ? "Rejected" : pendingDecision === "select" ? "Selected (converted to employee)" : "—"}</dd></div>
              </dl>
              <p className="mt-3 rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
                {pendingDecision === "reject"
                  ? "Consequence: the candidate's application is closed and they can no longer be progressed. A typed reason is recorded with the stage change."
                  : "Consequence: the candidate is converted to an employee with pre-hire data preserved. This is a stage conversion — no offer workflow is implied beyond the demo record."}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPendingDecision(null)}>Cancel</Button>
                <Button variant={pendingDecision === "reject" ? "destructive" : "default"} onClick={() => { void runStage(pendingDecision); setPendingDecision(null); }}>
                  Confirm {pendingDecision === "reject" ? "rejection" : "selection"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
