import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileSearch,
  Loader2,
  Lock,
  MessageSquareText,
  Send,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/rbac";
import { escalatePolicy, policyAsk, type PolicyAnswer } from "@/lib/api";

const SUGGESTED = [
  "How many days of annual leave do I get and how much can I carry over?",
  "Can I work fully remote if I get approval?",
  "How much can I claim for a certification course?",
  "What is the policy on sabbaticals and pet insurance?",
];

export default function PolicyStudio() {
  const { role, user } = useAuth();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<PolicyAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [escalating, setEscalating] = useState(false);

  if (role && !can(role, "use_policy_studio")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Policy Studio access only</h1>
          <p className="text-muted-foreground">Policy Q&A is available to employees and people teams.</p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  const ask = async (q: string) => {
    if (q.trim().length < 5) {
      toast.error("Ask a real question.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await policyAsk(q);
      setResult(res);
      if (res.status === "insufficient_evidence" && res.abstained) {
        toast.info("No policy covers this — abstained without calling the model.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Policy Q&A failed");
    } finally {
      setBusy(false);
    }
  };

  const escalate = async () => {
    if (!result || escalating) return;
    setEscalating(true);
    try {
      await escalatePolicy(question, result.status, result.best_score);
      toast.success("Escalated to HR — a recommendation was created for follow-up.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Escalation failed");
    } finally {
      setEscalating(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Policy Studio</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Grounded answers. <span className="text-primary">Or an honest abstention.</span>
          </h1>
          <p className="text-muted-foreground">
            Retrieval is deterministic; the model only writes answers grounded in verbatim policy
            quotes. If the policy corpus can't support an answer, WorkSense escalates — it never
            hallucinates.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <Textarea
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about a policy, e.g. how much annual leave do I get?"
              className="flex-1"
            />
            <Button size="xl" onClick={() => void ask(question)} disabled={busy}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              Ask
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuestion(s);
                  void ask(s);
                }}
                disabled={busy}
                className="rounded-md bg-muted px-3 py-1.5 text-left text-xs font-medium text-foreground transition-all duration-200 hover:scale-[1.02] hover:bg-border disabled:opacity-60"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {busy && (
          <div className="mt-8 flex items-center gap-3 rounded-lg bg-muted p-5 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Retrieving chunks deterministically… then grounding the answer.
          </div>
        )}

        {result && !busy && (
          <div className="mt-8 animate-fade-up flex flex-col gap-4">
            {result.status === "grounded" && (
              <div className="rounded-lg bg-secondary p-6 text-white">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
                  <CheckCircle2 className="h-5 w-5" /> Grounded answer
                </p>
                <p className="mt-3 text-lg font-semibold leading-relaxed">{result.answer}</p>
                <p className="mt-2 text-xs text-white/70">
                  Best retrieval score {result.best_score.toFixed(2)} / threshold {result.threshold} — all claims quote the policy verbatim.
                </p>
              </div>
            )}

            {result.status === "partially_supported" && (
              <div className="rounded-lg bg-accent p-6 text-foreground">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground/70">
                  <AlertTriangle className="h-5 w-5" /> Partially supported — HR review recommended
                </p>
                <p className="mt-3 text-lg font-semibold leading-relaxed">{result.answer || "Some claims could not be tied to a verbatim policy quote."}</p>
                {result.note && <p className="mt-2 text-sm text-foreground/70">{result.note}</p>}
              </div>
            )}

            {result.status === "insufficient_evidence" && (
              <div className="rounded-lg bg-destructive p-6 text-white">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
                  <XCircle className="h-5 w-5" />
                  {result.abstained ? "Insufficient evidence — abstained before any model call" : "Insufficient evidence — escalated to HR"}
                </p>
                <p className="mt-3 text-base font-semibold leading-relaxed">
                  No policy in the corpus covers this question (best retrieval score{" "}
                  {result.best_score.toFixed(2)} vs threshold {result.threshold}).
                  {result.abstained ? " The model was never called — nothing to hallucinate." : ""}
                </p>
                {result.note && <p className="mt-2 text-sm text-white/80">{result.note}</p>}
              </div>
            )}

            {result.status !== "insufficient_evidence" && result.citations.length > 0 && (
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <FileSearch className="h-4 w-4" /> Citations
                </p>
                <ul className="mt-3 flex flex-col divide-y divide-border">
                  {result.citations.map((c, i) => (
                    <li key={i} className="flex flex-col gap-1 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-foreground px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                          {c.doc_code}
                        </span>
                        <span className="text-sm font-semibold text-foreground">{c.section}</span>
                        <span className="text-xs text-muted-foreground">{c.claim}</span>
                      </div>
                      <blockquote className="rounded-md bg-muted px-3 py-2 text-sm italic text-foreground/80">
                        “{c.quote}”
                      </blockquote>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 rounded-lg bg-muted p-4">
              <p className="text-sm text-muted-foreground">
                Not satisfied or need a human decision? Escalate to HR — it creates a recommendation
                for follow-up.
              </p>
              <Button variant="outline" onClick={() => void escalate()} disabled={escalating}>
                {escalating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
                Escalate to HR
              </Button>
            </div>
          </div>
        )}

        <div className="mt-12 rounded-lg bg-foreground p-6 text-white">
          <BookOpen className="h-6 w-6 text-secondary" strokeWidth={2.5} />
          <h2 className="mt-3 text-base font-bold">How grounding works</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/80">
            Every question is scored against paragraph-level policy chunks with deterministic BM25
            retrieval — zero model credits. Only questions clearing the threshold reach the model,
            and every claim must quote a chunk verbatim or the answer is downgraded or discarded.
            Try the suggested question about <span className="font-semibold">sabbaticals</span> —
            it's deliberately not covered.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
