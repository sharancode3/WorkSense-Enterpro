import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Info,
  ListChecks,
  Loader2,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { ApiError, assessmentSessionDraft, assessmentSessionFetch, assessmentSessionSubmit, type AssessmentSessionView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ViewState =
  | { kind: "loading" }
  | { kind: "no_token" }
  | { kind: "not_found"; message: string }
  | { kind: "expired" }
  | { kind: "ready"; session: AssessmentSessionView };

type SaveState = "idle" | "pending" | "saved" | "error";

const SESSION_TYPE_LABEL: Record<string, string> = {
  work_sample: "Work sample",
  interview: "Structured interview",
  knowledge_assessment: "Knowledge assessment",
};

/** Extract a guidance budget like "up to 45 minutes" from the time_policy. */
function budgetMinutesFromPolicy(policy: string): number {
  const m = String(policy ?? "").match(/(\d+)\s*minutes?/i);
  return m ? Math.max(5, Number(m[1])) : 0;
}

function fmtClock(totalSec: number): string {
  const m = Math.max(0, Math.floor(totalSec / 60));
  const s = Math.max(0, totalSec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function CandidateSession() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [accommodation, setAccommodation] = useState<{ requested?: string; notes?: string }>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSaved, setLastSaved] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef("");
  const dirtyRef = useRef(false);

  // Guidance timer (client-side, informational — the server enforces expires_at).
  const [budgetMin, setBudgetMin] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);
  const [paused, setPaused] = useState(false);

  const questions = useMemo(
    () => (view.kind === "ready" ? view.session.blueprint.questions : []),
    [view]
  );
  const followUps = useMemo(
    () => (view.kind === "ready" ? view.session.follow_ups : []),
    [view]
  );

  // ---------------------------------------------------------------------------
  // Load. Re-runs cleanly when the token changes (no stale state from a
  // previous invitation leaking into the new one).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (loadedRef.current === token) return;
    loadedRef.current = token;
    setView({ kind: "loading" });
    setDrafts({});
    setAccommodation({});
    setSaveState("idle");
    setConfirmOpen(false);
    dirtyRef.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);

    if (!token) {
      setView({ kind: "no_token" });
      return;
    }
    assessmentSessionFetch({ token })
      .then((res) => {
        if (res.session.status === "expired") {
          setView({ kind: "expired" });
          return;
        }
        setDrafts(res.session.drafts ?? {});
        setAccommodation((res.session.accommodation ?? {}) as { requested?: string; notes?: string });
        const budget = budgetMinutesFromPolicy(res.session.time_policy);
        setBudgetMin(budget);
        setRemainingSec(budget * 60);
        setPaused(false);
        setView({ kind: "ready", session: res.session });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === "SESSION_EXPIRED") setView({ kind: "expired" });
        else setView({ kind: "not_found", message: err instanceof Error ? err.message : "Session not found." });
      });
  }, [token]);

  // Guidance countdown: budget minutes + accommodation effect (extra time),
  // paused by the break control. Purely informational.
  useEffect(() => {
    if (view.kind !== "ready" || view.session.status === "submitted" || paused || remainingSec <= 0) return;
    const t = setTimeout(() => setRemainingSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [view, remainingSec, paused]);

  // Warn before leaving with unsaved changes (reliability: navigation-with-unsaved).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const allQuestionKeys = useMemo(() => {
    const keys = [...questions.map((q) => q.key), ...followUps.map((f) => f.key)];
    const seen = new Set<string>();
    return keys.filter((k) => (seen.has(k) ? false : (seen.add(k), true)));
  }, [questions, followUps]);

  const answeredCount = useMemo(
    () => allQuestionKeys.filter((k) => (drafts[k] ?? "").trim().length > 0 || (view.kind === "ready" && (view.session.answers[k] ?? "").trim().length > 0)).length,
    [allQuestionKeys, drafts, view]
  );

  const scheduleSave = useCallback(
    (next: Record<string, string>, accommodationNext: { requested?: string; notes?: string }) => {
      if (view.kind !== "ready" || view.session.status === "submitted") return;
      dirtyRef.current = true;
      setSaveState("pending");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        assessmentSessionDraft(token, next, accommodationNext)
          .then((res) => {
            dirtyRef.current = false;
            setSaveState("saved");
            setLastSaved(new Date(res.saved_at).toLocaleTimeString());
          })
          .catch(() => {
            // Failed save: keep the banner so the candidate can retry; the next
            // keystroke (or the retry button) flushes again.
            setSaveState("error");
          });
      }, 1200);
    },
    [token, view]
  );

  const flushSave = useCallback(() => {
    if (view.kind !== "ready" || view.session.status === "submitted") return;
    if (!dirtyRef.current && saveState !== "error") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("pending");
    return assessmentSessionDraft(token, drafts, accommodation)
      .then((res) => {
        dirtyRef.current = false;
        setSaveState("saved");
        setLastSaved(new Date(res.saved_at).toLocaleTimeString());
      })
      .catch(() => setSaveState("error"));
  }, [view, token, drafts, accommodation, saveState]);

  const updateAnswer = (key: string, value: string) => {
    const next = { ...drafts, [key]: value };
    setDrafts(next);
    scheduleSave(next, accommodation);
  };

  const updateAccommodation = (patch: Partial<typeof accommodation>) => {
    const next = { ...accommodation, ...patch };
    setAccommodation(next);
    // Extra time +15 min affects the guidance timer immediately.
    if (patch.requested === "extra_time") setRemainingSec((s) => s + 15 * 60);
    scheduleSave(drafts, next);
  };

  const doSubmit = async () => {
    if (view.kind !== "ready") return;
    setSubmitting(true);
    try {
      await flushSave();
      const merged = { ...view.session.answers, ...drafts };
      const res = await assessmentSessionSubmit(token, merged, accommodation);
      toast.success("Submitted. Your answers are now final.");
      const refreshed = await assessmentSessionFetch({ token });
      setView({ kind: "ready", session: refreshed.session });
      setDrafts(refreshed.session.drafts ?? {});
      dirtyRef.current = false;
      setConfirmOpen(false);
      void res;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Submit failed";
      toast.error(msg);
      if (err instanceof ApiError && (err.code === "SESSION_EXPIRED" || err.code === "DUPLICATE_SUBMISSION" || err.code === "LOCKED")) {
        const refreshed = await assessmentSessionFetch({ token }).catch(() => null);
        if (refreshed?.session) setView({ kind: "ready", session: refreshed.session });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const accommodationExtra = accommodation.requested === "extra_time";
  const displayedRemaining = remainingSec + (accommodationExtra ? 15 * 60 : 0);

  const header = (
    <header className="border-b-2 border-border bg-background">
      <div className="mx-auto flex h-16 max-w-4xl items-center gap-2 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-extrabold text-white">
            W
          </span>
          <span className="text-lg font-bold tracking-tight text-foreground">WorkSense</span>
        </Link>
        <Link to="/candidate-status" className="ml-auto flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to status
        </Link>
      </div>
    </header>
  );

  if (view.kind === "loading") {
    return (
      <div className="flex min-h-screen flex-col bg-muted">
        {header}
        <main className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
      </div>
    );
  }

  if (view.kind === "no_token") {
    return (
      <div className="flex min-h-screen flex-col bg-muted">
        {header}
        <main className="mx-auto w-full max-w-xl px-4 py-24 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-2xl font-extrabold text-foreground">Missing invitation</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link does not include an invitation token. Use the invitation link you received by email, or check
            your application status below.
          </p>
          <Button className="mt-6" asChild>
            <Link to="/candidate-status">Check your application status</Link>
          </Button>
        </main>
      </div>
    );
  }

  if (view.kind === "not_found") {
    return (
      <div className="flex min-h-screen flex-col bg-muted">
        {header}
        <main className="mx-auto w-full max-w-xl px-4 py-24 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-2xl font-extrabold text-foreground">Invitation not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {view.message} The link may be mistyped, cancelled, or for a different application.
          </p>
          <Button className="mt-6" asChild>
            <Link to="/candidate-status">Check your application status</Link>
          </Button>
        </main>
      </div>
    );
  }

  if (view.kind === "expired") {
    return (
      <div className="flex min-h-screen flex-col bg-muted">
        {header}
        <main className="mx-auto w-full max-w-xl px-4 py-24 text-center">
          <Clock className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-2xl font-extrabold text-foreground">This invitation has expired</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The window for this assessment has closed, so your answers could not be saved or submitted. If you need more
            time or an accommodation, contact the recruiting team directly — they can reopen or extend your invitation.
          </p>
          <Button className="mt-6" asChild>
            <Link to="/candidate-status">Back to application status</Link>
          </Button>
        </main>
      </div>
    );
  }

  const { session } = view;
  const submitted = session.status === "submitted";
  const reopened = !submitted && session.follow_ups.length > 0 && Object.keys(session.answers).length > 0;
  const expiresAt = new Date(session.expires_at);
  const sessionTypeLabel = SESSION_TYPE_LABEL[session.session_type] ?? session.session_type.replace(/_/g, " ");
  const progressPct = allQuestionKeys.length > 0 ? Math.round((answeredCount / allQuestionKeys.length) * 100) : 0;
  const largerText = accommodation.requested === "larger_text";

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="inline-block rounded-md bg-foreground px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
              {sessionTypeLabel}
            </span>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              {session.blueprint.title}
            </h1>
          </div>
          <span
            className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
              submitted
                ? "bg-secondary text-white"
                : session.status === "expired"
                  ? "bg-destructive text-white"
                  : "bg-primary text-white"
            }`}
          >
            {submitted ? "Submitted" : `Open until ${expiresAt.toLocaleDateString()}`}
          </span>
        </div>

        {/* Duration · progress · save state (live region for screen readers). */}
        <div
          className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          {budgetMin > 0 && !submitted && (
            <span className="inline-flex items-center gap-1.5" aria-label="Guidance timer">
              <Timer className="h-4 w-4" />
              {displayedRemaining > 0 ? (
                <>
                  {fmtClock(displayedRemaining)} remaining
                  {accommodationExtra && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                      +15 min extra-time accommodation
                    </span>
                  )}
                </>
              ) : (
                "Time budget reached"
              )}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5" aria-label="Progress">
            <ListChecks className="h-4 w-4" /> {answeredCount} of {allQuestionKeys.length} answered ({progressPct}%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Save className="h-4 w-4" />
            {saveState === "pending" && "Saving…"}
            {saveState === "saved" && `Saved at ${lastSaved}`}
            {saveState === "idle" && "Answers autosave as you type"}
            {saveState === "error" && "Not saved — connection problem"}
          </span>
        </div>

        {progressPct > 0 && !submitted && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        )}

        {saveState === "error" && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-destructive p-4 text-white">
            <AlertTriangle className="h-5 w-5" />
            <p className="flex-1 text-sm font-semibold">
              Your latest changes could not be saved. Keep typing — we will retry automatically — or save now.
            </p>
            <Button size="sm" variant="secondary" onClick={() => void flushSave()}>
              <RefreshCw className="h-4 w-4" /> Save now
            </Button>
          </div>
        )}

        {submitted ? (
          <div className="mt-6 flex flex-col gap-4">
            <div className="rounded-lg bg-secondary p-5 text-white">
              <p className="flex items-center gap-2 text-base font-bold">
                <CheckCircle2 className="h-5 w-5" /> Thank you — your answers were submitted.
              </p>
              <p className="mt-1 text-sm text-white/85">
                Submitted at {session.submitted_at ? new Date(session.submitted_at).toLocaleString() : ""}. Your answers
                are locked and cannot be changed. A human reviewer confirms the evaluation before it affects anything —
                you will be notified.
              </p>
            </div>
            {session.blueprint.questions.map((q) => (
              <div key={q.key} className="rounded-lg bg-white p-5">
                <p className="font-bold text-foreground">{q.prompt}</p>
                <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-foreground">
                  {session.answers[q.key] || "No answer submitted."}
                </p>
              </div>
            ))}
            {session.follow_ups.map((f) => (
              <div key={f.key} className="rounded-lg bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-primary">Follow-up question</p>
                <p className="mt-1 font-bold text-foreground">{f.prompt}</p>
                <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-foreground">
                  {session.answers[f.key] || "No answer submitted."}
                </p>
              </div>
            ))}
            <div className="rounded-lg bg-muted p-5 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Reference: {session.submission_hash ?? "—"}
              </p>
              <p className="mt-1 flex items-center gap-2">
                <Lock className="h-4 w-4" /> No scores are shown to candidates — your answers are evidence, not a verdict.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-lg bg-white p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Instructions</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {session.blueprint.instructions}
              </p>
            </div>

            {!reopened && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="rounded-lg bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Accommodation</p>
                  <select
                    value={accommodation.requested ?? "none"}
                    onChange={(e) => updateAccommodation({ requested: e.target.value })}
                    className="mt-2 h-11 w-full rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:outline-none"
                  >
                    <option value="none">No accommodation needed</option>
                    <option value="extra_time">Extra time (+15 min)</option>
                    <option value="larger_text">Larger text</option>
                    <option value="break">Scheduled break</option>
                    <option value="screen_reader">Screen reader</option>
                  </select>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {accommodation.requested === "extra_time" &&
                      "Your guidance timer gets +15 minutes and the recruiting team is notified."}
                    {accommodation.requested === "larger_text" &&
                      "Answer boxes render in a larger size; the recruiting team is notified."}
                    {accommodation.requested === "break" &&
                      "Use the pause control to stop the guidance timer for your break."}
                    {accommodation.requested === "screen_reader" &&
                      "Recorded for the recruiting team. This page already supports standard keyboard and screen-reader navigation — if anything is still hard to use, contact them before submitting."}
                    {accommodation.requested === "none" && "Optional — noted for the recruiting team."}
                  </p>
                </label>
                <label className="rounded-lg bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Anything else we should know?</p>
                  <input
                    value={accommodation.notes ?? ""}
                    onChange={(e) => updateAccommodation({ notes: e.target.value })}
                    placeholder="Optional — support notes for the recruiter"
                    aria-label="Additional accommodation or support notes for the recruiter"
                    className="mt-2 h-11 w-full rounded-md bg-muted px-3 text-sm text-foreground focus:outline-none"
                  />
                </label>
              </div>
            )}

            {reopened && (
              <div className="mt-4 rounded-lg bg-primary/10 p-4 text-sm text-foreground">
                <p className="font-bold text-primary">Follow-up round</p>
                <p className="mt-1">
                  The reviewer asked a follow-up after your first answers. Your earlier answers are kept as submitted;
                  please answer the questions below.
                </p>
              </div>
            )}

            <div className={`mt-4 flex flex-col gap-4 ${largerText ? "text-lg" : ""}`}>
              {questions.map((q) => {
                const readOnly = reopened && Boolean(session.answers[q.key]);
                const value = readOnly ? session.answers[q.key] : drafts[q.key] ?? "";
                return (
                  <div key={q.key} className="rounded-lg bg-white p-5">
                    <label htmlFor={`answer-${q.key}`} className="font-bold text-foreground">
                      {q.prompt}
                    </label>
                    {q.hint && <p className="mt-1 text-sm text-muted-foreground">{q.hint}</p>}
                    <Textarea
                      id={`answer-${q.key}`}
                      rows={7}
                      value={value}
                      onChange={(e) => !readOnly && updateAnswer(q.key, e.target.value)}
                      readOnly={readOnly}
                      maxLength={q.max_chars}
                      aria-label={`Your answer to question ${q.key}`}
                      className={`mt-3 ${readOnly ? "opacity-70" : ""} ${largerText ? "text-lg" : ""}`}
                      placeholder={readOnly ? "Submitted answer (locked)" : "Your answer…"}
                    />
                    <p className="mt-1 text-right text-xs text-muted-foreground">
                      {value.length} / {q.max_chars}
                    </p>
                  </div>
                );
              })}
              {followUps.map((f) => (
                <div key={f.key} className="rounded-lg bg-primary/5 p-5">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary">Follow-up question</p>
                  <label htmlFor={`answer-${f.key}`} className="mt-1 block font-bold text-foreground">
                    {f.prompt}
                  </label>
                  <Textarea
                    id={`answer-${f.key}`}
                    rows={5}
                    value={drafts[f.key] ?? ""}
                    onChange={(e) => updateAnswer(f.key, e.target.value)}
                    maxLength={3000}
                    aria-label={`Your answer to follow-up question ${f.key}`}
                    className={`mt-3 ${largerText ? "text-lg" : ""}`}
                    placeholder="Your answer…"
                  />
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col items-end gap-2">
              {budgetMin > 0 && !submitted && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPaused((p) => !p)}
                  disabled={accommodation.requested !== "break"}
                >
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {paused ? "Resume timer" : "Pause timer (break)"}
                </Button>
              )}
              <Button size="lg" onClick={() => setConfirmOpen(true)} disabled={submitting}>
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ClipboardCheck className="h-5 w-5" />}
                {reopened ? "Submit follow-up answers" : "Submit my answers"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Submitting locks your answers — you can autosave as long as you like, but once submitted they are final.
              </p>
            </div>
          </>
        )}
      </main>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-lg bg-white p-6">
            <h2 id="confirm-title" className="text-lg font-extrabold text-foreground">
              Submit your answers?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Once submitted, your answers become final and cannot be edited. They are reviewed by a person before they
              influence any decision, and you will not be shown internal scores. If you are not ready, you can keep
              drafting — nothing is locked until you submit.
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              {answeredCount} of {allQuestionKeys.length} questions have an answer. Autosave is {saveState === "error" ? "having trouble — check your connection" : "on"}.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Keep drafting
              </Button>
              <Button onClick={() => void doSubmit()}>Submit now</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
