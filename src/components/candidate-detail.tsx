import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  FileText,
  History,
  Loader2,
  MessagesSquare,
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
import { ResumeReviewFlow } from "@/components/resume-review-flow";
import { AssessmentReviewPanel } from "@/components/assessment-review-panel";
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
  onChanged: () => void;
}

export function CandidateDetail({ open, onOpenChange, candidate, req, app, onChanged }: Props) {
  const qc = useQueryClient();
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
  // Resume provenance
  const [provenance, setProvenance] = useState<{ document_id: string; version: number; artifact_ref: string; file_name: string; checksum_short: string } | null>(null);
  const [resumeMode, setResumeMode] = useState<"file" | "text">("file");
  const [resumeText, setResumeText] = useState("");
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractResult, setExtractResult] = useState<{ skills: string[]; years: number; fit: number | null } | null>(null);

  const resumeDocuments = useQuery({
    queryKey: ["candidate-resume-docs", candidate.id],
    queryFn: async () => {
      const { data: docs } = await supabase
        .from("resume_documents")
        .select("id, file_name, status, page_count, checksum, created_at, low_text")
        .eq("twin_id", candidate.id)
        .order("created_at", { ascending: false });
      const { data: versions } = await supabase
        .from("resume_versions")
        .select("id, document_id, version, review_state, reviewed_at, created_at")
        .eq("twin_id", candidate.id)
        .order("version", { ascending: false });
      return {
        documents: (docs ?? []) as { id: string; file_name: string; status: string; page_count: number | null; checksum: string; created_at: string; low_text: boolean }[],
        versions: (versions ?? []) as { id: string; document_id: string; version: number; review_state: string; reviewed_at: string | null; created_at: string }[],
      };
    },
    enabled: open,
  });

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
      void qc.invalidateQueries({ queryKey: ["candidate-resume-docs", candidate.id] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
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

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            if (v === "assessments") setAssessOpen(true);
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
                <Button size="sm" variant="outline" onClick={() => void runStage("reject")} disabled={busy === `reject-${candidate.id}`}>
                  Reject
                </Button>
              </div>
            )}
            {app && stage === "final_round" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 p-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Decision</span>
                <Button size="sm" onClick={() => void runStage("select")} disabled={busy === `select-${candidate.id}`}>
                  {busy === `select-${candidate.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Select — convert to employee
                </Button>
                <Button size="sm" variant="outline" onClick={() => void runStage("reject")} disabled={busy === `reject-${candidate.id}`}>
                  Reject
                </Button>
                <p className="ml-auto text-[11px] text-muted-foreground">Selection is human-only — model output never changes it.</p>
              </div>
            )}
          </TabsContent>

          {/* Resume: intake + provenance + revision history */}
          <TabsContent value="resume" className="flex flex-col gap-4">
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

          {/* Interview: kit + evaluation */}
          <TabsContent value="interview" className="flex flex-col gap-4">
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

          {/* Assessments: sessions + reviewer confirmation flow */}
          {app && (
            <TabsContent value="assessments">
              <div className="flex flex-col items-center gap-3 rounded-lg bg-muted px-6 py-12 text-center">
                <Briefcase className="h-7 w-7 text-primary" />
                <p className="max-w-md text-sm text-muted-foreground">
                  Work-sample and interview sessions for this application, blueprint versions, and the reviewer
                  confirmation flow that turns model drafts into verified evidence.
                </p>
              </div>
            </TabsContent>
          )}
        </Tabs>
        {app && (
          <AssessmentReviewPanel
            open={assessOpen}
            onOpenChange={setAssessOpen}
            application={app}
            candidate={{ id: candidate.id, name: candidate.name, email: candidate.email ?? "" }}
            reqId={req?.id ?? ""}
            reqTitle={req?.title ?? ""}
            onChanged={onChanged}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
