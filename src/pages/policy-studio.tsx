import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileSearch,
  HelpCircle,
  Loader2,
  Lock,
  MessageSquareText,
  Send,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/rbac";
import { escalatePolicy, policyAsk, policyContext, type PolicyAnswer, type PolicyContextResult } from "@/lib/api";

const EXAMPLES = [
  "How many days of annual leave do I get and how much can I carry over?",
  "I joined in March — how much leave will I have accrued by year end?",
  "Does a leave request over the December holidays use fewer leave days?",
  "Can I work fully remote with approval?",
  "What is the policy on sabbaticals and pet insurance?",
];

interface ContextForm {
  employee_id: string;
  location: string;
  worker_type: string;
  taken_days: string;
  request_from: string;
  request_to: string;
}

const EMPTY_CONTEXT: ContextForm = {
  employee_id: "",
  location: "",
  worker_type: "",
  taken_days: "",
  request_from: "",
  request_to: "",
};

function SourceInspection({ retrieval }: { retrieval: PolicyAnswer["retrieval"] }) {
  const [open, setOpen] = useState(false);
  if (!retrieval || retrieval.length === 0) return null;
  return (
    <div className="rounded-lg bg-white p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <FileSearch className="h-4 w-4" /> Sources inspected ({retrieval.length})
        </p>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {retrieval.map((c, i) => (
            <div key={i} className="rounded-md bg-muted p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-foreground px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                  {c.doc_code} v{c.version ?? "?"}
                </span>
                <span className="text-sm font-semibold text-foreground">{c.heading}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  effective {c.effective_from ?? "—"}{c.effective_to ? ` → ${c.effective_to}` : ""}
                </span>
              </div>
              <blockquote className="mt-2 text-sm italic text-foreground/80">{c.text}</blockquote>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PolicyStudio() {
  const { role, user } = useAuth();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<PolicyAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [form, setForm] = useState<ContextForm>(EMPTY_CONTEXT);
  const [ctx, setCtx] = useState<PolicyContextResult | null>(null);
  const [confirmEscalate, setConfirmEscalate] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalated, setEscalated] = useState(false);

  useEffect(() => {
    if (!user || !ctxOpen) return;
    policyContext()
      .then(setCtx)
      .catch(() => setCtx(null));
  }, [ctxOpen, user]);

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
    setEscalated(false);
    setConfirmEscalate(false);
    try {
      const res = await policyAsk(
        q,
        form.employee_id || undefined,
        {
          location: form.location || undefined,
          worker_type: form.worker_type || undefined,
          taken_days: form.taken_days ? Number(form.taken_days) : undefined,
          request_from: form.request_from || undefined,
          request_to: form.request_to || undefined,
        }
      );
      setResult(res);
      if (res.status === "insufficient_evidence" && res.abstained && !res.note) {
        toast.info("No policy covers this — abstained without calling the model.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Policy Q&A failed");
    } finally {
      setBusy(false);
    }
  };

  const beginEscalate = async () => {
    if (!result || escalating) return;
    const hasSensitive = Boolean(result.employee_context?.name) || Boolean(form.employee_id);
    if (hasSensitive) {
      setConfirmEscalate(true);
      return;
    }
    await doEscalate();
  };

  const doEscalate = async () => {
    if (!result) return;
    setEscalating(true);
    try {
      const ctxPayload = {
        employee: result.employee_context ?? null,
        location: form.location || undefined,
        worker_type: form.worker_type || undefined,
        taken_days: form.taken_days ? Number(form.taken_days) : undefined,
      };
      const sources = result.retrieval.slice(0, 5).map((c) => ({
        doc_code: c.doc_code,
        version: c.version,
        section: c.section_code,
        heading: c.heading,
      }));
      await escalatePolicy(question, ctxPayload, sources, result.note ?? undefined);
      setEscalated(true);
      setConfirmEscalate(false);
      toast.success("Escalated — an HR workflow is now open for this question.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Escalation failed — nothing was escalated.");
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
            Retrieval is deterministic and date-aware. The model only writes answers grounded in verbatim quotes
            from the cited section of the cited policy version — and if it can't, it says so.
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
            {EXAMPLES.map((s) => (
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

          <button
            type="button"
            onClick={() => setCtxOpen((o) => !o)}
            className="flex items-center gap-2 self-start rounded-md bg-white px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary shadow-sm"
          >
            <UserRound className="h-4 w-4" />
            {ctxOpen ? "Hide" : "Add"} employee / applicability context
            {ctxOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {ctxOpen && (
            <div className="grid gap-3 rounded-lg bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-muted-foreground">Employee</span>
                <select
                  value={form.employee_id}
                  onChange={(e) => {
                    const emp = ctx?.employees.find((x) => x.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      employee_id: e.target.value,
                      location: emp?.work_location ?? f.location,
                      worker_type: emp?.worker_type ?? f.worker_type,
                    }));
                  }}
                  className="h-11 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:outline-none"
                >
                  <option value="">Not specified</option>
                  {(ctx?.employees ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-muted-foreground">Work location</span>
                <select
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  className="h-11 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:outline-none"
                >
                  <option value="">Not specified</option>
                  <option value="US">US</option>
                  <option value="EU">EU</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-muted-foreground">Worker type</span>
                <select
                  value={form.worker_type}
                  onChange={(e) => setForm((f) => ({ ...f, worker_type: e.target.value }))}
                  className="h-11 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:outline-none"
                >
                  <option value="">Not specified</option>
                  <option value="full_time">Full time</option>
                  <option value="part_time">Part time</option>
                  <option value="contractor">Contractor</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-muted-foreground">Leave already taken (days)</span>
                <Input
                  type="number"
                  min={0}
                  value={form.taken_days}
                  onChange={(e) => setForm((f) => ({ ...f, taken_days: e.target.value }))}
                  placeholder="0"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-muted-foreground">Request from</span>
                <Input type="date" value={form.request_from} onChange={(e) => setForm((f) => ({ ...f, request_from: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-muted-foreground">Request to</span>
                <Input type="date" value={form.request_to} onChange={(e) => setForm((f) => ({ ...f, request_to: e.target.value }))} />
              </label>
            </div>
          )}
        </div>

        {busy && (
          <div className="mt-8 flex items-center gap-3 rounded-lg bg-muted p-5 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Applying org / date / applicability filters, retrieving chunks, then grounding the answer.
          </div>
        )}

        {result && !busy && (
          <div className="mt-8 flex animate-fade-up flex-col gap-4">
            {result.status === "grounded" && (
              <div className="rounded-lg bg-secondary p-6 text-white">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
                  <CheckCircle2 className="h-5 w-5" /> Grounded answer
                </p>
                <p className="mt-3 text-lg font-semibold leading-relaxed">{result.answer}</p>
                {result.employee_context?.name && (
                  <p className="mt-2 text-xs text-white/70">
                    Context: {result.employee_context.name}
                    {result.employee_context.work_location ? ` · ${result.employee_context.work_location}` : ""}
                    {result.employee_context.worker_type ? ` · ${result.employee_context.worker_type}` : ""}
                  </p>
                )}
                <p className="mt-2 text-xs text-white/70">
                  Best retrieval score {result.best_score.toFixed(2)} / threshold {result.threshold} — every claim quotes
                  the cited section verbatim.
                </p>
              </div>
            )}

            {result.status === "clarification_needed" && (
              <div className="rounded-lg bg-primary/10 p-6 text-foreground">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                  <HelpCircle className="h-5 w-5" /> Clarification needed — I won't guess
                </p>
                <p className="mt-3 text-base font-semibold leading-relaxed">{result.clarification?.reason}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Fill in {result.clarification?.fields.map((f) => f.replace(/_/g, " ")).join(" and ")} in the context
                  panel above, then ask again — the answer changes depending on it.
                </p>
              </div>
            )}

            {result.status === "partially_supported" && (
              <div className="rounded-lg bg-accent p-6 text-foreground">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground/70">
                  <AlertTriangle className="h-5 w-5" /> Partially supported — not labeled grounded
                </p>
                <p className="mt-3 text-lg font-semibold leading-relaxed">{result.answer || "Some claims could not be tied to a verbatim quote."}</p>
                {result.note && <p className="mt-2 text-sm text-foreground/70">{result.note}</p>}
              </div>
            )}

            {result.status === "insufficient_evidence" && (
              <div className="rounded-lg bg-destructive p-6 text-white">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
                  <XCircle className="h-5 w-5" />
                  {result.abstained ? "Insufficient evidence — abstained honestly" : "Insufficient evidence — nothing was labeled grounded"}
                </p>
                <p className="mt-3 text-base font-semibold leading-relaxed">
                  {result.note ||
                    `No policy in the corpus covers this question (best retrieval score ${result.best_score.toFixed(2)} vs threshold ${result.threshold}).`}
                </p>
                {result.abstained && (
                  <p className="mt-2 text-sm text-white/80">
                    {result.note ? "The model was never called — nothing to hallucinate." : "The model was never called."}
                  </p>
                )}
              </div>
            )}

            {result.computed && (
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <ClipboardCheck className="h-4 w-4" /> Deterministic calculation
                </p>
                {result.computed.balance && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["Accrued (days)", result.computed.balance.accrued_days],
                      ["Taken", result.computed.balance.taken_days],
                      ["Unused", result.computed.balance.unused_days],
                      ["Carryover", `${result.computed.balance.carryover_days} (cap ${result.computed.balance.carryover_cap_days})`],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md bg-muted p-3 text-center">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                        <p className="mt-1 text-xl font-extrabold text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                )}
                {result.computed.request_span && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    The request spans {result.computed.request_span.calendar_days} calendar days, of which{" "}
                    {result.computed.request_span.holiday_days} are public holidays — it consumes{" "}
                    <b className="text-foreground">{result.computed.request_span.leave_days_consumed} leave days</b>.
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Numbers are computed by the deterministic leave engine (as of {result.computed.balance?.as_of ?? "today"}) and cited against the policy.
                </p>
              </div>
            )}

            {result.status !== "insufficient_evidence" && result.citations.length > 0 && (
              <div className="rounded-lg bg-white p-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <FileSearch className="h-4 w-4" /> Citations (document version · section · quote)
                </p>
                <ul className="mt-3 flex flex-col divide-y divide-border">
                  {result.citations.map((c, i) => (
                    <li key={i} className="flex flex-col gap-1 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-foreground px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                          {c.doc_code} v{c.version}
                        </span>
                        <span className="text-sm font-semibold text-foreground">
                          {c.section} {c.heading ? `· ${c.heading}` : ""}
                        </span>
                        {c.effective_from && (
                          <span className="text-[11px] text-muted-foreground">
                            effective {c.effective_from}{c.effective_to ? ` → ${c.effective_to}` : ""}
                          </span>
                        )}
                      </div>
                      <blockquote className="rounded-md bg-muted px-3 py-2 text-sm italic text-foreground/80">
                        “{c.exact_quote}”
                      </blockquote>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <SourceInspection retrieval={result.retrieval} />

            <div className="flex items-center justify-between gap-4 rounded-lg bg-muted p-4">
              <p className="text-sm text-muted-foreground">
                {escalated
                  ? "This question has been escalated — an HR workflow is now open for follow-up."
                  : "Need a human decision? Escalate to HR. It opens a separate workflow with the question, the sources inspected, and your context."}
              </p>
              <Button
                variant="outline"
                onClick={() => void beginEscalate()}
                disabled={escalating || escalated || result.status === "clarification_needed"}
              >
                {escalating ? <Loader2 className="h-4 w-4 animate-spin" /> : escalated ? <CheckCircle2 className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}
                {escalated ? "Escalated to HR" : "Escalate to HR"}
              </Button>
            </div>
          </div>
        )}

        {confirmEscalate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-lg bg-white p-6">
              <h3 className="flex items-center gap-2 text-lg font-extrabold text-foreground">
                <ShieldCheck className="h-5 w-5 text-primary" /> Include sensitive context?
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                This escalation will include the selected employee context ({result?.employee_context?.name ?? "specified employee"} and
                location/leave details) plus the policy sources inspected. HR reviewers can see it. Confirm to send it, or
                escalate without context.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmEscalate(false)}>Cancel</Button>
                <Button variant="outline" onClick={() => { setForm((f) => ({ ...f, employee_id: "" })); setConfirmEscalate(false); void doEscalate(); }}>
                  Escalate without context
                </Button>
                <Button onClick={() => void doEscalate()}>Include context & escalate</Button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-12 rounded-lg bg-foreground p-6 text-white">
          <BookOpen className="h-6 w-6 text-secondary" strokeWidth={2.5} />
          <h2 className="mt-3 text-base font-bold">How grounding works</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/80">
            Every question is scored with deterministic BM25 retrieval against the <b>current</b> policy versions
            (date window + supersession applied first). Location/worker-type applicability is checked before answering —
            missing fields trigger a clarification, never a guess. Every claim must quote the cited section verbatim, or
            the answer is repaired once and then discarded rather than labeled grounded. Expired and excluded policies are
            surfaced honestly, never silently ignored.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
