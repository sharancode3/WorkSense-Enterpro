import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ClipboardList, ExternalLink, Loader2, Lock, Search } from "lucide-react";
import { ApiError, fetchCandidateStatus, type CandidateStatusResult } from "@/lib/api";
import { DEMO_CANDIDATE_CODE } from "@/lib/demo-accounts";
import { forbiddenIncludes } from "@/lib/security";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: CandidateStatusResult }
  | { kind: "forbidden"; fields: string[]; message: string }
  | { kind: "error"; message: string };

const STAGE_BADGE: Record<string, string> = {
  final_round: "bg-secondary text-white",
  technical_interview: "bg-primary text-white",
  screening: "bg-accent text-foreground",
  selected: "bg-foreground text-white",
  rejected: "bg-destructive text-white",
};

const STAGE_LABEL: Record<string, string> = {
  screening: "Under Review",
  technical_interview: "Interview Scheduled",
  final_round: "Decision Pending",
  selected: "Offer Extended",
  rejected: "Not moving forward",
};

export default function CandidateStatus() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") ?? DEMO_CANDIDATE_CODE);
  const [view, setView] = useState<ViewState>({ kind: "idle" });

  const check = async (include?: string[]) => {
    if (!code.trim()) {
      toast.error("Enter your application code.");
      return;
    }
    setView({ kind: "loading" });
    try {
      const data = await fetchCandidateStatus(code.trim(), include);
      setView({ kind: "success", data });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "FORBIDDEN" || err.code === "FORBIDDEN_FIELD" || /scores, rubrics|not available to candidates/i.test(err.message)) {
          setView({ kind: "forbidden", fields: forbiddenIncludes(include), message: err.message });
          return;
        }
        setView({ kind: "error", message: err.message });
        return;
      }
      setView({ kind: "error", message: "Unexpected error" });
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <header className="border-b-2 border-border bg-background">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-extrabold text-white">
              W
            </span>
            <span className="text-lg font-bold tracking-tight text-foreground">WorkSense</span>
          </Link>
          <Link to="/" className="ml-auto flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to landing
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 sm:px-6">
        <div className="rounded-lg bg-white p-8">
          <span className="inline-block rounded-md bg-foreground px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
            Candidate application status
          </span>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            <Lock className="h-3 w-3" /> Demonstration data is fictional — this portal serves the demo application code only.
          </p>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
            Where does your application stand?
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Enter the application code from your confirmation email. You'll see your status and
            your own extracted skill summary — nothing else.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. WS-PRIYA-2026"
              className="h-12"
            />
            <Button
              size="xl"
              onClick={() => void check()}
              disabled={view.kind === "loading"}
              className="sm:w-44"
            >
              {view.kind === "loading" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              Check status
            </Button>
          </div>

          {view.kind === "success" && (
            <div className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-3 rounded-lg bg-muted p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Application status</p>
                  <p className="mt-1 text-2xl font-extrabold capitalize text-foreground">
                    {STAGE_LABEL[view.data.application_status] ?? view.data.application_status.replace(/_/g, " ")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {view.data.requisition.title} · {view.data.requisition.department}
                  </p>
                </div>
                <span
                  className={`inline-flex w-fit items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                    STAGE_BADGE[view.data.application_status] ?? "bg-muted text-foreground"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" /> Live
                </span>
              </div>

              {(view.data.sessions ?? []).length > 0 && (
                <div className="rounded-lg bg-muted p-6">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <ClipboardList className="h-4 w-4" /> Your assessment sessions
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {view.data.sessions?.map((s) => (
                      <div
                        key={s.token}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-bold text-foreground">{s.title}</p>
                          <p className="text-xs capitalize text-muted-foreground">
                            {s.session_type.replace(/_/g, " ")} ·{" "}
                            {s.status === "submitted"
                              ? "Submitted"
                              : `Open until ${new Date(s.expires_at).toLocaleDateString()}`}
                          </p>
                        </div>
                        {s.status === "submitted" ? (
                          <span className="rounded-md bg-foreground px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white">
                            Submitted
                          </span>
                        ) : (
                          <Button size="sm" asChild>
                            <Link to={`/candidate/session?token=${encodeURIComponent(s.token)}`}>
                              {s.status === "in_progress" ? "Continue" : "Start"} session
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Sessions are invitation-only. Your answers are saved automatically; evaluation stays with the
                    recruitment team.
                  </p>
                </div>
              )}

              <div className="rounded-lg bg-muted p-6">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Your verified skill summary
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {view.data.applicant.verified_skills.length > 0 ? (
                    view.data.applicant.verified_skills.map((s) => (
                      <span
                        key={s.name}
                        className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-foreground"
                      >
                        {s.name} · {s.proficiency}/5
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No skills extracted yet.</p>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                size="xl"
                onClick={() => void check(["score", "rubric", "notes"])}
              >
                <Lock className="h-5 w-5" /> Request full evaluation (score / rubric / notes)
              </Button>
            </div>
          )}

          {view.kind === "forbidden" && (
            <div className="mt-6 rounded-lg bg-destructive p-6 text-white">
              <p className="flex items-center gap-2 text-base font-bold">
                <Lock className="h-5 w-5" /> 403 — FORBIDDEN_FIELD
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/90">{view.message}</p>
              <p className="mt-3 rounded-md bg-white/15 px-3 py-2 text-xs font-mono text-white/90">
                requested: {view.fields.length > 0 ? view.fields.join(", ") : "protected fields"}
              </p>
            </div>
          )}

          {view.kind === "error" && (
            <div className="mt-6 rounded-lg bg-destructive p-6 text-white">
              <p className="text-base font-bold">Request failed</p>
              <p className="mt-1 text-sm text-white/90">{view.message}</p>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Candidates never see scores, rubrics, recruiter notes, or internal evaluations — the
          backend refuses them explicitly.
        </p>
      </main>
    </div>
  );
}
