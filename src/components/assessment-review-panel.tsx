import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Loader2,
  MessageSquarePlus,
  Send,
  TriangleAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  assessmentBlueprintList,
  assessmentBlueprintSeed,
  assessmentEvaluate,
  assessmentReview,
  assessmentSessionCreate,
  assessmentSessionFetch,
  assessmentSessionResume,
  fetchModelJob,
  type ApplicationRow,
  type AssessmentEvaluation,
  type AssessmentSessionView,
  type RubricAnchorRow,
} from "@/lib/api";

interface CandidateBrief {
  id: string;
  name: string;
  email: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  application: ApplicationRow;
  candidate: CandidateBrief;
  reqId: string;
  reqTitle: string;
  onChanged: () => void;
}

interface SessionListItem {
  id: string;
  session_type: string;
  status: string;
  expires_at: string;
  submitted_at: string | null;
  blueprint_title: string;
}

interface BlueprintListItem {
  id: string;
  competency: string;
  artifact_spec: { title: string; kind: string };
  rubrics: RubricAnchorRow[];
}

interface ReviewDraft {
  competency: string;
  judgment: string;
  evidence_quotes: string[];
  reason: string;
}

const ANCHOR_LABEL: Record<string, string> = {
  "1": "Red flag",
  "2": "Developing",
  "3": "Competent",
  "4": "Advanced",
  "5": "Master",
  NOT_ASSESSED: "Not assessed",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
};

const STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  in_progress: "In progress",
  submitted: "Submitted",
  expired: "Expired",
  cancelled: "Cancelled",
};

async function loadSessionList(applicationId: string): Promise<SessionListItem[]> {
  const { data: sess } = await supabase
    .from("candidate_sessions")
    .select("id, session_type, status, expires_at, submitted_at, blueprint_id")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  const blueprintIds = [...new Set((sess ?? []).map((s) => s.blueprint_id))];
  const { data: bps } = blueprintIds.length > 0
    ? await supabase.from("assessment_blueprints").select("id, artifact_spec").in("id", blueprintIds)
    : { data: [] };
  const titleById = new Map((bps ?? []).map((b) => [b.id, (b.artifact_spec as { title?: string })?.title ?? b.id]));
  return (sess ?? []).map((s) => ({
    id: s.id,
    session_type: s.session_type,
    status: s.status,
    expires_at: s.expires_at,
    submitted_at: s.submitted_at,
    blueprint_title: titleById.get(s.blueprint_id) ?? "Assessment",
  }));
}

export function AssessmentReviewPanel({ open, onOpenChange, application, candidate, reqId, reqTitle, onChanged }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [blueprints, setBlueprints] = useState<BlueprintListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<{ session: AssessmentSessionView; rubrics: RubricAnchorRow[]; evaluation: AssessmentEvaluation["result"] | null } | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newType, setNewType] = useState<"work_sample" | "interview">("work_sample");
  const [newBlueprint, setNewBlueprint] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [jobPolling, setJobPolling] = useState(false);

  const loadSessions = useCallback(async () => {
    const [list, bps] = await Promise.all([
      loadSessionList(application.id),
      assessmentBlueprintList(reqId).catch(() => ({ ok: true, blueprints: [] })),
    ]);
    setSessions(list);
    setBlueprints(bps.blueprints);
  }, [application.id, reqId]);

  useEffect(() => {
    if (!open) return;
    void loadSessions();
  }, [open, loadSessions]);

  const openDetail = async (sessionId: string) => {
    setSelectedId(sessionId);
    setDetailBusy(true);
    try {
      const res = await assessmentSessionFetch({ session_id: sessionId });
      setDetail({ session: res.session, rubrics: res.rubrics ?? [], evaluation: res.evaluation ?? null });
      const drafts: Record<string, ReviewDraft> = {};
      for (const r of res.rubrics ?? []) {
        const ai = res.evaluation?.ai.judgments.find((j) => j.competency === r.competency);
        drafts[r.competency] = {
          competency: r.competency,
          judgment: ai?.judgment ?? "NOT_ASSESSED",
          evidence_quotes: ai?.evidence_quotes ?? [],
          reason: "",
        };
      }
      setReviewDrafts(drafts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the session.");
    } finally {
      setDetailBusy(false);
    }
  };

  const runEvaluate = async () => {
    if (!detail) return;
    setEvaluating(true);
    try {
      const res = await assessmentEvaluate(detail.session.id);
      setDetail((d) => (d ? { ...d, evaluation: res.result } : d));
      toast.success("AI judgment ready — review it before it counts.");
      onChanged();
    } catch (err) {
      const jobId = err instanceof ApiError ? String(err.context?.job_id ?? "") : "";
      if (jobId && jobId !== "undefined") {
        toast.info("The model is still working — checking the job…");
        await pollJob(jobId);
      } else {
        toast.error(err instanceof Error ? err.message : "Evaluation failed — try again in a moment.");
      }
    } finally {
      setEvaluating(false);
    }
  };

  const pollJob = async (jobId: string) => {
    setJobPolling(true);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const res = await fetchModelJob(jobId);
        if (res.job.status === "succeeded") {
          if (detail) {
            const ref = await assessmentSessionFetch({ session_id: detail.session.id });
            setDetail({ session: ref.session, rubrics: ref.rubrics ?? [], evaluation: ref.evaluation ?? null });
          }
          toast.success("Evaluation completed.");
          onChanged();
          setJobPolling(false);
          return;
        }
        if (res.job.status === "failed") {
          toast.error(`Evaluation failed: ${res.job.error_message ?? res.job.error_code ?? "unknown"}`);
          setJobPolling(false);
          return;
        }
      } catch {
        /* keep polling */
      }
    }
    toast.error("Evaluation is taking longer than expected — check back shortly.");
    setJobPolling(false);
  };

  const saveReview = async (determination: "confirm" | "override") => {
    if (!detail || !detail.evaluation) return;
    setSaving(true);
    try {
      const judgments = (detail.rubrics ?? []).map((r) => {
        const d = reviewDrafts[r.competency] ?? { competency: r.competency, judgment: "NOT_ASSESSED", evidence_quotes: [], reason: "" };
        return { competency: r.competency, judgment: d.judgment, evidence_quotes: d.evidence_quotes, reason: d.reason || undefined };
      });
      const res = await assessmentReview(
        detail.evaluation.assessment_id,
        determination,
        judgments,
        determination === "override" ? "Human calibration pass." : undefined
      );
      toast.success(`Review saved (${determination}) — fit updated to ${Math.round((res.fit.current ?? 0) * 100)}/100.`);
      onChanged();
      const ref = await assessmentSessionFetch({ session_id: detail.session.id });
      setDetail({ session: ref.session, rubrics: ref.rubrics ?? [], evaluation: ref.evaluation ?? null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review save failed.");
    } finally {
      setSaving(false);
    }
  };

  const sendFollowUps = async () => {
    if (!detail || !detail.evaluation) return;
    const candidates = detail.evaluation.ai.judgments
      .filter((j) => j.suggested_follow_up && j.suggested_follow_up.trim().length > 0)
      .slice(0, 2)
      .map((j) => ({ key: j.competency, prompt: j.suggested_follow_up }));
    if (candidates.length === 0) {
      toast.info("No follow-up needed — the AI reports no remaining uncertainty.");
      return;
    }
    try {
      const res = await assessmentSessionResume(detail.session.id, candidates);
      toast.success(`Follow-up round sent (${res.follow_ups_issued} question${res.follow_ups_issued === 1 ? "" : "s"}).`);
      onChanged();
      await openDetail(detail.session.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send follow-ups.");
    }
  };

  const createSession = async () => {
    if (!newBlueprint) return;
    setCreating(true);
    try {
      await assessmentSessionCreate({ application_id: application.id, blueprint_id: newBlueprint, session_type: newType });
      toast.success("Invitation created — share the link with the candidate.");
      setNewSessionOpen(false);
      await loadSessions();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the invitation.");
    } finally {
      setCreating(false);
    }
  };

  const seedBlueprints = async () => {
    try {
      const res = await assessmentBlueprintSeed(reqId);
      toast.success(`Seeded ${res.seeded.length} blueprint(s) with rubrics.`);
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Seeding failed.");
    }
  };

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const unansweredFollowUps = (detail?.session.follow_ups ?? []).filter((f) => !detail?.session.answers[f.key]);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSelectedId(""); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            Assessments · {candidate.name} · {reqTitle}
          </DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[74vh] grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-[240px_1fr]">
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sessions</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {sessions.length === 0 && <p className="text-xs text-muted-foreground">No sessions yet.</p>}
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void openDetail(s.id)}
                    className={`rounded-md p-2 text-left text-sm transition-colors ${
                      selectedId === s.id ? "bg-foreground text-white" : "bg-white text-foreground hover:bg-white/70"
                    }`}
                  >
                    <span className="block font-bold">{s.blueprint_title}</span>
                    <span className={`text-xs ${selectedId === s.id ? "text-white/75" : "text-muted-foreground"}`}>
                      {s.session_type.replace(/_/g, " ")} · {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Blueprints</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {blueprints.length === 0 && (
                  <Button size="sm" variant="outline" onClick={() => void seedBlueprints()}>
                    Seed canonical blueprints
                  </Button>
                )}
                {blueprints.map((b) => (
                  <span key={b.id} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-foreground">
                    {b.artifact_spec.title}
                  </span>
                ))}
              </div>
              {blueprints.length > 0 && (
                <Button size="sm" className="mt-2 w-full" onClick={() => { setNewSessionOpen(true); setNewBlueprint(blueprints[0]?.id ?? ""); }}>
                  <Send className="h-4 w-4" /> New invitation
                </Button>
              )}
            </div>

            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Application stage:{" "}
                <b className="text-foreground">{application.stage.replace(/_/g, " ")}</b> v{application.version}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {!selected && (
              <p className="rounded-lg bg-muted p-6 text-center text-sm text-muted-foreground">
                Select a session to review it.
              </p>
            )}
            {detailBusy && (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-muted p-10 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading session…
              </div>
            )}
            {selected && detail && !detailBusy && (
              <>
                <div className="rounded-lg bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-foreground">{detail.session.blueprint.title}</p>
                    <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-foreground">
                      {STATUS_LABEL[detail.session.status] ?? detail.session.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {detail.session.session_type.replace(/_/g, " ")} · {candidate.name}
                  </p>
                  {detail.session.status !== "submitted" && detail.session.status !== "expired" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" asChild>
                        <a href={`/candidate/session?token=${detail.session.invitation_token ?? ""}`} target="_blank" rel="noreferrer">
                          Open candidate page
                        </a>
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Invite token: {detail.session.invitation_token}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  {detail.session.blueprint.questions.map((q) => (
                    <div key={q.key} className="rounded-lg bg-white p-4">
                      <p className="text-sm font-bold text-foreground">{q.prompt}</p>
                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-foreground">
                        {detail.session.answers[q.key] || (
                          <span className="italic text-muted-foreground">No answer submitted.</span>
                        )}
                      </p>
                    </div>
                  ))}
                  {detail.session.follow_ups.map((f) => (
                    <div key={f.key} className="rounded-lg bg-primary/5 p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-primary">Follow-up · {f.source}</p>
                      <p className="mt-1 text-sm font-bold text-foreground">{f.prompt}</p>
                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-foreground">
                        {detail.session.answers[f.key] || (
                          <span className="italic text-muted-foreground">Awaiting round-2 answer.</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>

                {!detail.evaluation ? (
                  detail.session.status === "submitted" ? (
                    <div className="rounded-lg bg-white p-4">
                      <p className="text-sm text-muted-foreground">
                        The candidate submitted answers. Run the evidence-linked evaluation to produce anchor judgments.
                      </p>
                      <Button className="mt-3" onClick={() => void runEvaluate()} disabled={evaluating || jobPolling}>
                        {evaluating || jobPolling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                        Evaluate against rubric
                      </Button>
                      <p className="mt-2 text-xs text-muted-foreground">
                        No code is executed — work samples are reviewed as written work only.
                      </p>
                    </div>
                  ) : (
                    <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                      Waiting for the candidate to submit before evaluation.
                      {unansweredFollowUps.length > 0 && ` Follow-up questions pending: ${unansweredFollowUps.length}.`}
                    </p>
                  )
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="rounded-lg bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 font-bold text-foreground">
                          <Cpu className="h-4 w-4 text-primary" /> AI judgment ·{" "}
                          <span className="text-xs font-medium text-muted-foreground">{detail.evaluation.ai.model}</span>
                        </p>
                        {!detail.evaluation.reviewed ? (
                          <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-foreground">
                            Needs human review
                          </span>
                        ) : (
                          <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white">
                            Reviewed · {detail.evaluation.reviewed.determination}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-col gap-3">
                        {(detail.rubrics ?? []).map((r) => {
                          const ai = detail.evaluation!.ai.judgments.find((j) => j.competency === r.competency);
                          const draft = reviewDrafts[r.competency] ?? { competency: r.competency, judgment: "NOT_ASSESSED", evidence_quotes: [], reason: "" };
                          const reviewed = detail.evaluation!.reviewed?.judgments.find((j) => j.competency === r.competency);
                          return (
                            <div key={r.competency} className="rounded-md bg-muted p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-bold text-foreground">{r.competency}</p>
                                <div className="flex items-center gap-2">
                                  {ai && (
                                    <span className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${ai.judgment === "NOT_ASSESSED" || ai.judgment === "INSUFFICIENT_EVIDENCE" ? "bg-destructive text-white" : "bg-foreground text-white"}`}>
                                      AI {ai.judgment}
                                    </span>
                                  )}
                                  {reviewed && (
                                    <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
                                      {reviewed.judgment} {reviewed.judgment !== ai?.judgment ? "(overridden)" : ""}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {ai && ai.evidence_quotes.length > 0 && (
                                <ul className="mt-2 flex flex-col gap-1">
                                  {ai.evidence_quotes.map((q, i) => (
                                    <li key={i} className="rounded bg-white px-2 py-1 text-xs italic text-muted-foreground">
                                      “{q}”
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {!detail.evaluation!.reviewed && (
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <label className="flex flex-col gap-1">
                                    <span className="text-xs font-semibold text-muted-foreground">Final anchor</span>
                                    <select
                                      value={draft.judgment}
                                      onChange={(e) => setReviewDrafts((d) => ({ ...d, [r.competency]: { ...d[r.competency], judgment: e.target.value } }))}
                                      className="h-10 rounded-md bg-white px-2 text-sm font-medium text-foreground focus:outline-none"
                                    >
                                      {["1", "2", "3", "4", "5", "NOT_ASSESSED", "INSUFFICIENT_EVIDENCE"].map((v) => (
                                        <option key={v} value={v}>
                                          {v} · {ANCHOR_LABEL[v]}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    <span className="text-xs font-semibold text-muted-foreground">Reason (required to override)</span>
                                    <input
                                      value={draft.reason}
                                      onChange={(e) => setReviewDrafts((d) => ({ ...d, [r.competency]: { ...d[r.competency], reason: e.target.value } }))}
                                      placeholder="e.g. quote actually supports a higher anchor"
                                      className="h-10 rounded-md bg-white px-2 text-sm text-foreground focus:outline-none"
                                    />
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {detail.evaluation.ai.summary && (
                        <p className="mt-3 text-sm text-muted-foreground">{detail.evaluation.ai.summary}</p>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">{detail.evaluation.code_execution.note}</p>
                      {!detail.evaluation.reviewed && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button onClick={() => void saveReview("confirm")} disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Confirm &amp; save
                          </Button>
                          <Button variant="outline" onClick={() => void saveReview("override")} disabled={saving}>
                            <TriangleAlert className="h-4 w-4" /> Save with corrections
                          </Button>
                          <Button variant="ghost" onClick={() => void sendFollowUps()}>
                            <MessageSquarePlus className="h-4 w-4" /> Send follow-up round
                          </Button>
                        </div>
                      )}
                      {detail.evaluation.reviewed && (
                        <div className="mt-3 rounded-md bg-secondary/10 p-3 text-xs text-muted-foreground">
                          <p className="font-bold text-secondary">
                            Reviewed by {detail.evaluation.reviewed.by} · {new Date(detail.evaluation.reviewed.at).toLocaleString()}
                          </p>
                          {detail.evaluation.reviewed.reason && <p className="mt-1">{detail.evaluation.reviewed.reason}</p>}
                          <p className="mt-1">The AI suggestion is preserved alongside the human determination.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {newSessionOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-lg bg-white p-6">
              <h3 className="text-lg font-extrabold text-foreground">New assessment invitation</h3>
              <div className="mt-4 flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-muted-foreground">Blueprint</span>
                  <select
                    value={newBlueprint}
                    onChange={(e) => setNewBlueprint(e.target.value)}
                    className="h-11 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:outline-none"
                  >
                    {blueprints.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.artifact_spec.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-muted-foreground">Session type</span>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as "work_sample" | "interview")}
                    className="h-11 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:outline-none"
                  >
                    <option value="work_sample">Work sample</option>
                    <option value="interview">Interview session</option>
                  </select>
                </label>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> The invitation expires in 72 hours by default.
                </p>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setNewSessionOpen(false)}>Cancel</Button>
                <Button onClick={() => void createSession()} disabled={creating || !newBlueprint}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Create invitation
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
