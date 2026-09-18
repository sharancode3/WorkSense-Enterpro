import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  Lock,
  Save,
  ShieldCheck,
} from "lucide-react";
import { ApiError, assessmentSessionDraft, assessmentSessionFetch, assessmentSessionSubmit, type AssessmentSessionView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ViewState =
  | { kind: "loading" }
  | { kind: "not_found"; message: string }
  | { kind: "expired" }
  | { kind: "ready"; session: AssessmentSessionView };

const SAVE_IDLE = "idle";
const SAVE_PENDING = "pending";
const SAVE_SAVED = "saved";

export default function CandidateSession() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [accommodation, setAccommodation] = useState<{ requested?: string; notes?: string }>({});
  const [saveState, setSaveState] = useState<typeof SAVE_IDLE | typeof SAVE_PENDING | typeof SAVE_SAVED>(SAVE_IDLE);
  const [lastSaved, setLastSaved] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);

  const questions = useMemo(
    () => (view.kind === "ready" ? view.session.blueprint.questions : []),
    [view]
  );
  const followUps = useMemo(
    () => (view.kind === "ready" ? view.session.follow_ups : []),
    [view]
  );

  // Load once per token.
  useEffect(() => {
    if (!token || loadedRef.current) return;
    loadedRef.current = true;
    setView({ kind: "loading" });
    assessmentSessionFetch({ token })
      .then((res) => {
        if (res.session.status === "expired") {
          setView({ kind: "expired" });
          return;
        }
        setDrafts(res.session.drafts ?? {});
        setAccommodation((res.session.accommodation ?? {}) as { requested?: string; notes?: string });
        setView({ kind: "ready", session: res.session });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === "SESSION_EXPIRED") setView({ kind: "expired" });
        else setView({ kind: "not_found", message: err instanceof Error ? err.message : "Session not found." });
      });
  }, [token]);

  const allQuestionKeys = useMemo(() => {
    const keys = [...questions.map((q) => q.key), ...followUps.map((f) => f.key)];
    const seen = new Set<string>();
    return keys.filter((k) => (seen.has(k) ? false : (seen.add(k), true)));
  }, [questions, followUps]);

  const scheduleSave = (next: Record<string, string>, accommodationNext: { requested?: string; notes?: string }) => {
    if (view.kind !== "ready" || view.session.status === "submitted") return;
    setSaveState(SAVE_PENDING);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      assessmentSessionDraft(token, next, accommodationNext)
        .then((res) => {
          setSaveState(SAVE_SAVED);
          setLastSaved(new Date(res.saved_at).toLocaleTimeString());
        })
        .catch(() => {
          setSaveState(SAVE_IDLE);
          toast.error("Autosave failed — your changes are only on this screen. Check your connection and keep going.");
        });
    }, 1200);
  };

  const updateAnswer = (key: string, value: string) => {
    const next = { ...drafts, [key]: value };
    setDrafts(next);
    scheduleSave(next, accommodation);
  };

  const updateAccommodation = (patch: Partial<typeof accommodation>) => {
    const next = { ...accommodation, ...patch };
    setAccommodation(next);
    scheduleSave(drafts, next);
  };

  const doSubmit = async () => {
    if (view.kind !== "ready") return;
    setSubmitting(true);
    try {
      // Preserve already-submitted round-1 answers; add round-2 follow-up answers.
      const merged = { ...view.session.answers, ...drafts };
      const res = await assessmentSessionSubmit(token, merged, accommodation);
      toast.success("Submitted. Your answers are now final.");
      const refreshed = await assessmentSessionFetch({ token });
      setView({ kind: "ready", session: refreshed.session });
      setDrafts(refreshed.session.drafts ?? {});
      setConfirmOpen(false);
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

  if (view.kind === "not_found") {
    return (
      <div className="flex min-h-screen flex-col bg-muted">
        {header}
        <main className="mx-auto w-full max-w-xl px-4 py-24 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-2xl font-extrabold text-foreground">Invitation not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">{view.message}</p>
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
            The window for this assessment has closed. If you need more time or accommodation, contact the recruiting
            team directly — we can reopen or extend your invitation.
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

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="inline-block rounded-md bg-foreground px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
              {session.session_type === "work_sample" ? "Work sample" : "Interview session"}
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

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> {session.time_policy || "Plan for up to 45 minutes."}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Save className="h-4 w-4" />
            {saveState === SAVE_PENDING && "Saving…"}
            {saveState === SAVE_SAVED && `Saved at ${lastSaved}`}
            {saveState === SAVE_IDLE && "Answers autosave as you type"}
          </span>
        </div>

        {submitted ? (
          <div className="mt-6 flex flex-col gap-4">
            <div className="rounded-lg bg-secondary p-5 text-white">
              <p className="flex items-center gap-2 text-base font-bold">
                <CheckCircle2 className="h-5 w-5" /> Thank you — your answers were submitted.
              </p>
              <p className="mt-1 text-sm text-white/85">
                Submitted at {session.submitted_at ? new Date(session.submitted_at).toLocaleString() : ""}. Your answers
                are locked and cannot be changed. Evaluation stays with the recruiting team — you will be notified.
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
                    <option value="larger_text">Larger text / screen reader</option>
                    <option value="break">Scheduled break</option>
                  </select>
                </label>
                <label className="rounded-lg bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Anything else we should know?</p>
                  <input
                    value={accommodation.notes ?? ""}
                    onChange={(e) => updateAccommodation({ notes: e.target.value })}
                    placeholder="Optional — support notes for the recruiter"
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

            <div className="mt-4 flex flex-col gap-4">
              {questions.map((q) => {
                const readOnly = reopened && Boolean(session.answers[q.key]);
                return (
                  <div key={q.key} className="rounded-lg bg-white p-5">
                    <p className="font-bold text-foreground">{q.prompt}</p>
                    {q.hint && <p className="mt-1 text-sm text-muted-foreground">{q.hint}</p>}
                    <Textarea
                      rows={7}
                      value={readOnly ? session.answers[q.key] : drafts[q.key] ?? ""}
                      onChange={(e) => !readOnly && updateAnswer(q.key, e.target.value)}
                      readOnly={readOnly}
                      maxLength={q.max_chars}
                      className={`mt-3 ${readOnly ? "opacity-70" : ""}`}
                      placeholder={readOnly ? "Submitted answer (locked)" : "Your answer…"}
                    />
                    <p className="mt-1 text-right text-xs text-muted-foreground">
                      {(readOnly ? session.answers[q.key] ?? "" : drafts[q.key] ?? "").length} / {q.max_chars}
                    </p>
                  </div>
                );
              })}
              {followUps.map((f) => (
                <div key={f.key} className="rounded-lg bg-primary/5 p-5">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary">Follow-up question</p>
                  <p className="mt-1 font-bold text-foreground">{f.prompt}</p>
                  <Textarea
                    rows={5}
                    value={drafts[f.key] ?? ""}
                    onChange={(e) => updateAnswer(f.key, e.target.value)}
                    maxLength={3000}
                    className="mt-3"
                    placeholder="Your answer…"
                  />
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col items-end gap-2">
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
          <div className="w-full max-w-md rounded-lg bg-white p-6">
            <h2 className="text-lg font-extrabold text-foreground">Submit your answers?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Once submitted, your answers become final and cannot be edited. You can continue drafting until you are
              ready.
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
