import { useCallback, useEffect, useRef, useState } from "react";
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
  Plus,
  Send,
  ShieldAlert,
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
import {
  escalatePolicy,
  listEscalations,
  policyAsk,
  policyContext,
  policyConversationList,
  policyConversationLinkEscalation,
  policyConversationMessages,
  policyConversationSave,
  respondEscalation,
  type PolicyAnswer,
  type PolicyContextResult,
  type PolicyConversationRow,
  type PolicyEscalationRow,
  type PolicyMessageRow,
} from "@/lib/api";

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
  as_of: string;
}

const EMPTY_CONTEXT: ContextForm = {
  employee_id: "",
  location: "",
  worker_type: "",
  taken_days: "",
  request_from: "",
  request_to: "",
  as_of: "",
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

/** Batch G: renders a persisted answer exactly like the live one — citations,
 *  computed facts and sources all survive the round-trip. */
function AnswerContent({ answer }: { answer: PolicyAnswer }) {
  const result = answer;
  return (
    <div className="flex animate-fade-up flex-col gap-4">
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
          {result.certainty_note && <p className="mt-1 text-[11px] italic text-white/60">{result.certainty_note}</p>}
          {result.employee_context?.context_source && (
            <p className="mt-1 text-[11px] text-white/70">
              Context source: {Object.entries(result.employee_context.context_source).map(([k, v]) => `${k}=${v}`).join(" · ") || "none"} — hypothetical fields are explicitly marked.
            </p>
          )}
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

      {result.status === "conflicting_policies" && (
        <div className="rounded-lg bg-amber-100 p-6 text-amber-900" role="alert">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <ShieldAlert className="h-5 w-5" /> Conflicting policies — nothing was silently chosen
          </p>
          <p className="mt-3 text-base font-semibold leading-relaxed">{result.conflict?.reason}</p>
          <div className="mt-3 flex flex-col gap-2">
            {(result.conflict?.candidates ?? []).map((c) => (
              <div key={c.doc_code} className="rounded-md bg-white p-3 text-sm">
                <span className="rounded bg-foreground px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                  {c.doc_code} v{c.version ?? "?"}
                </span>
                <span className="ml-2 font-bold">{c.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {c.section_code} · score {c.score.toFixed(2)} · effective {c.effective_from ?? "—"}
                </span>
                <p className="mt-1 text-xs italic text-amber-800">{c.heading}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-amber-800">
            Review both sources below and reconcile the conflict, or escalate to HR for a decision.
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
    </div>
  );
}

const statusLabel = (answer: unknown): string => {
  const s = (answer as PolicyAnswer | undefined)?.status;
  return s ? s.replace(/_/g, " ") : "answer";
};

export default function PolicyStudio() {
  const { role, user, twin: me } = useAuth();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Batch G: conversations are server-persisted and owner-scoped. The previous
  // shared sessionStorage draft is gone — it leaked between personas in one tab.
  const [conversations, setConversations] = useState<PolicyConversationRow[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState("");
  const [messages, setMessages] = useState<PolicyMessageRow[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);

  const [ctxOpen, setCtxOpen] = useState(false);
  const [form, setForm] = useState<ContextForm>(EMPTY_CONTEXT);
  const [ctx, setCtx] = useState<PolicyContextResult | null>(null);
  const [confirmEscalate, setConfirmEscalate] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalationId, setEscalationId] = useState<string | null>(null);
  const [escalationsOpen, setEscalationsOpen] = useState(false);
  const [escalations, setEscalations] = useState<PolicyEscalationRow[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [responseStatus, setResponseStatus] = useState<"open" | "in_progress" | "resolved" | "closed">("in_progress");
  const [responseBusy, setResponseBusy] = useState(false);

  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant") ?? null;
  const result: PolicyAnswer | null = latestAssistant ? (latestAssistant.answer as PolicyAnswer) : null;
  const escalated = Boolean(latestAssistant?.escalation_id);

  const loadConversations = useCallback(async () => {
    setConvsLoading(true);
    try {
      const res = await policyConversationList();
      setConversations(res.conversations);
    } catch {
      toast.error("Could not load your policy conversations.");
    } finally {
      setConvsLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    setMsgsLoading(true);
    try {
      const res = await policyConversationMessages(id);
      setActiveTitle(res.conversation.title);
      setMessages(res.messages);
    } catch {
      toast.error("Could not load this conversation.");
    } finally {
      setMsgsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!user || !ctxOpen) return;
    policyContext()
      .then(setCtx)
      .catch(() => setCtx(null));
  }, [ctxOpen, user]);

  // Employees: default the selector to the logged-in user (item 17).
  const isEmployee = role === "employee";
  const effectiveEmployeeId = form.employee_id || (isEmployee ? me?.id ?? "" : "");

  const loadEscalations = useCallback(async () => {
    try {
      const res = await listEscalations();
      setEscalations(res.escalations);
    } catch {
      toast.error("Could not load escalations.");
    }
  }, []);

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

  const openConversation = (id: string) => {
    setActiveConvId(id);
    void loadMessages(id);
  };

  const newConversation = () => {
    setActiveConvId(null);
    setActiveTitle("");
    setMessages([]);
    setQuestion("");
    setEscalationId(null);
    inputRef.current?.focus();
  };

  const ask = async (q: string) => {
    if (q.trim().length < 5) {
      toast.error("Ask a real question.");
      return;
    }
    // Per-submit idempotency key: retrying the SAME ask cannot duplicate rows.
    const requestId = crypto.randomUUID();
    setBusy(true);
    try {
      const res = await policyAsk(
        q,
        effectiveEmployeeId || undefined,
        {
          location: form.location || undefined,
          worker_type: form.worker_type || undefined,
          taken_days: form.taken_days ? Number(form.taken_days) : undefined,
          request_from: form.request_from || undefined,
          request_to: form.request_to || undefined,
          as_of: form.as_of || undefined,
        }
      );
      setLastRequestId(requestId);
      const saved = await policyConversationSave({
        conversation_id: activeConvId ?? undefined,
        question: q.trim(),
        answer: res,
        request_id: requestId,
      });
      setActiveConvId(saved.conversation_id);
      setEscalationId(null);
      await Promise.all([loadConversations(), loadMessages(saved.conversation_id)]);
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
      const res = await escalatePolicy(question, ctxPayload, sources, result.note ?? undefined);
      // Persist the link on the assistant message of THIS request so the
      // conversation history keeps the escalation (Batch G).
      if (activeConvId && lastRequestId) {
        try {
          await policyConversationLinkEscalation(activeConvId, lastRequestId, res.escalation_id);
        } catch {
          toast.warning("Escalation created, but linking it to this conversation failed.");
        }
      }
      setEscalationId(res.escalation_id);
      setConfirmEscalate(false);
      toast.success("Escalation submitted — an HR workflow is now open for this question.");
      if (activeConvId) await loadMessages(activeConvId);
      if (escalationsOpen) await loadEscalations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Escalation failed — nothing was submitted.");
    } finally {
      setEscalating(false);
    }
  };

  const submitResponse = async (row: PolicyEscalationRow) => {
    setResponseBusy(true);
    try {
      await respondEscalation(row.id, responseStatus, responseText);
      toast.success(`Escalation ${responseStatus}. Response recorded in its history.`);
      setResponseText("");
      setRespondingId(null);
      await loadEscalations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the response.");
    } finally {
      setResponseBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Policy Studio</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            Grounded answers. <span className="text-primary">Or an honest abstention.</span>
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Retrieval is deterministic and date-aware. The model only writes answers grounded in verbatim quotes
            from the cited section of the cited policy version — and if it can't, it says so. Every question and
            answer is saved to your private conversation history.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Batch G: private conversation list — owner-scoped, server-persisted */}
          <aside className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" /> Conversations
              </p>
              <Button size="sm" variant="outline" onClick={newConversation} aria-label="New question">
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {convsLoading && conversations.length === 0 && (
                <div className="h-20 animate-pulse rounded-md bg-muted" role="status" aria-label="Loading conversations" />
              )}
              {!convsLoading && conversations.length === 0 && (
                <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  No saved conversations yet. Ask a question and it will be kept here privately.
                </p>
              )}
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openConversation(c.id)}
                  className={`flex flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors ${activeConvId === c.id ? "bg-primary/10" : "hover:bg-muted"}`}
                >
                  <span className="truncate text-sm font-bold text-foreground">{c.title}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {new Date(c.updated_at).toLocaleDateString()} · {c.last_message ? statusLabel(c.last_message.answer) : "empty"}
                    {c.last_message?.escalation_id ? " · escalated" : ""}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="flex flex-col gap-3">
            {/* Question composer */}
            <div className="flex items-end gap-3">
              <Textarea
                ref={inputRef}
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

            {activeConvId ? (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <MessageSquareText className="h-3.5 w-3.5 text-primary" /> Continuing “{activeTitle}” — replies append here.
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Plus className="h-3.5 w-3.5 text-primary" /> Asking now starts a new private conversation.
              </p>
            )}

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

            {isEmployee && !form.employee_id && (
              <p className="flex items-center gap-1.5 self-start text-xs font-semibold text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Answering with your own saved context (you) — pick another employee above only if you have access.
              </p>
            )}

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
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-muted-foreground">As of (historical date)</span>
                  <Input
                    type="date"
                    value={form.as_of}
                    onChange={(e) => setForm((f) => ({ ...f, as_of: e.target.value }))}
                    title="Ask against the policy version effective on this date (leave blank for today)."
                  />
                  <span className="text-[11px] text-muted-foreground">Uses the policy version effective that day.</span>
                </label>
              </div>
            )}

            {busy && (
              <div className="flex items-center gap-3 rounded-lg bg-muted p-5 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Applying org / date / applicability filters, retrieving chunks, then grounding the answer.
              </div>
            )}

            {/* Batch G: full persisted history for the active conversation */}
            {msgsLoading && messages.length === 0 && (
              <div className="mt-6 h-24 animate-pulse rounded-lg bg-muted" role="status" aria-label="Loading conversation" />
            )}

            {messages.length > 0 && !msgsLoading && (
              <div className="mt-6 flex flex-col gap-5">
                {messages.map((m, i) => {
                  if (m.role === "user") {
                    return (
                      <div key={m.id} className="flex justify-end">
                        <div className="max-w-[85%] rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white">
                          {m.question}
                        </div>
                      </div>
                    );
                  }
                  const isLatest = i === messages.length - 1;
                  return (
                    <div key={m.id} className="flex flex-col gap-3">
                      <AnswerContent answer={m.answer as PolicyAnswer} />
                      {m.escalation_id && (
                        <p className="flex items-center gap-1.5 rounded-md bg-muted px-4 py-2 text-xs font-semibold text-foreground">
                          <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                          Escalated to HR (id {m.escalation_id.slice(0, 8)}) — an HR workflow is open for follow-up.
                        </p>
                      )}
                      {isLatest && (
                        <div className="flex items-center justify-between gap-4 rounded-lg bg-muted p-4">
                          <p className="text-sm text-muted-foreground">
                            {escalated
                              ? "This question has been escalated — an HR workflow is open for follow-up."
                              : "Need a human decision? Escalate to HR. It opens a separate workflow with the question, the sources inspected, and your context."}
                          </p>
                          <div className="flex shrink-0 gap-2">
                            <Button variant="ghost" size="sm" onClick={() => { setEscalationsOpen((o) => !o); if (!escalationsOpen) void loadEscalations(); }}>
                              {escalationsOpen ? "Hide escalations" : "Escalations"}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => void beginEscalate()}
                              disabled={escalating || escalated || result?.status === "clarification_needed" || result?.status === "conflicting_policies"}
                            >
                              {escalating ? <Loader2 className="h-4 w-4 animate-spin" /> : escalated ? <CheckCircle2 className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}
                              {escalated ? "Escalation submitted" : "Escalate to HR"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!msgsLoading && messages.length === 0 && !busy && (
              <div className="mt-6 rounded-lg bg-muted p-6 text-sm text-muted-foreground">
                No messages yet in this conversation — your questions and their grounded answers (with citations)
                will be saved here privately.
              </div>
            )}

            {/* Escalations workflow */}
            {escalationsOpen && (
              <div className="mt-8 flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                  <MessageSquareText className="h-5 w-5 text-primary" strokeWidth={2.5} /> Escalations
                </h2>
                {escalations.length === 0 && (
                  <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                    No escalations in your scope yet. Questions escalated here get an owner, a status, a response and a
                    full history.
                  </p>
                )}
                {escalations.map((row) => (
                  <div key={row.id} className="rounded-lg bg-white p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-foreground">{row.question}</p>
                      <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${row.status === "resolved" ? "bg-secondary text-white" : row.status === "closed" ? "bg-muted text-foreground" : row.status === "in_progress" ? "bg-accent text-foreground" : "bg-destructive/20 text-destructive"}`}>
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {new Date(row.created_at).toLocaleString()} · owner {row.owner_twin_id ? "assigned" : "unassigned"}
                      {row.responded_at ? ` · responded ${new Date(row.responded_at).toLocaleString()}` : ""}
                    </p>
                    {row.response_text && (
                      <p className="mt-2 rounded-md bg-muted p-3 text-sm text-foreground">Response: {row.response_text}</p>
                    )}
                    {(row.history ?? []).length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          History ({row.history.length})
                        </summary>
                        <ul className="mt-2 flex flex-col gap-1">
                          {(row.history ?? []).map((h, i) => (
                            <li key={i} className="rounded-md bg-muted px-3 py-1.5 text-xs text-foreground">
                              <b>{h.by}</b> · {new Date(h.at).toLocaleString()} · {h.from ?? "—"} → {h.to}
                              {h.response ? ` — "${h.response}"` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {can(role, "view_all_workforce") && row.status !== "resolved" && row.status !== "closed" && (
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        {respondingId === row.id ? (
                          <>
                            <select
                              value={responseStatus}
                              onChange={(e) => setResponseStatus(e.target.value as typeof responseStatus)}
                              className="h-10 rounded-md bg-muted px-2 text-sm font-medium text-foreground focus:outline-none"
                              aria-label="Response status"
                            >
                              <option value="in_progress">In progress</option>
                              <option value="resolved">Resolved</option>
                              <option value="closed">Closed</option>
                            </select>
                            <Input
                              value={responseText}
                              onChange={(e) => setResponseText(e.target.value)}
                              placeholder="Response text (required to resolve/close)…"
                              className="h-10 min-w-[200px] flex-1"
                            />
                            <Button size="sm" onClick={() => void submitResponse(row)} disabled={responseBusy}>
                              {responseBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              Save response
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRespondingId(null)}>Cancel</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setRespondingId(row.id)}>
                            Respond / update status
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-8 rounded-lg bg-foreground p-5 text-white">
              <p className="text-sm font-bold">
                How this works — grounded, or an honest abstention.
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/80">
                Deterministic BM25 retrieval runs against the policy version effective on your "as of" date, filtered by
                organization, location, worker type and applicability — then the model may only answer with verbatim quotes
                from the cited section. Missing context triggers a clarification, conflicting current policies are surfaced
                (never silently chosen), and every retrieval score is labeled a ranking signal, not answer certainty.
                Conversations are private to you.
              </p>
            </div>
          </div>
        </div>

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
      </div>
    </AppShell>
  );
}
