import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { callQwen, QwenError, sanitizeUntrusted, wrapUntrusted } from "../_shared/qwen.ts";
import {
  ABSTENTION_THRESHOLD,
  applicabilityOk,
  currentVersionSet,
  exclusiveQuestionTokens,
  filterOutOfWindow,
  missingApplicability,
  retrieveChunks,
  validateCitations,
  type PolicyDoc,
  type RetrievedChunk,
} from "../_shared/policy-retrieval.ts";
import { canViewEmployee, findEmployeeMention, type CallerView, type EmployeeView } from "../_shared/policy-context.ts";
import { leaveDaysConsumed, leaveSummary, monthsInLeaveYear } from "../_shared/leave-calc.ts";
import { US_PUBLIC_HOLIDAYS_2026 } from "../_shared/policy-seed.ts";
import { validatePolicyAnswer } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const NL = String.fromCharCode(10);

const GROUNDING_SYSTEM = `You are the WorkSense HR Policy Reasoning Agent. Answer using ONLY the provided policy excerpts and the authoritative computed facts. If they do not contain the answer, set status to "insufficient_evidence" and say so plainly — never invent a policy, an exception, an eligibility fact, or a number.
Chunk headers may carry tags: [RETIRED yyyy-mm-dd] means that document was retired and may only be used to state that the policy no longer applies. [DOES NOT APPLY - context] means that document does not apply to the given employee context and may only be used to state that the exception does not apply.
Every material claim MUST include a citation: doc_code (POL-...), version (integer), section (the section code, e.g. "s1"), and an exact_quote copied VERBATIM from that exact section of that document version.
The numeric facts in <authoritative_computed_facts> are exact and authoritative — restate them as given, never recalculate them.
Respond with JSON only:
{"status":"grounded_response|insufficient_evidence","answer":"string","citations":[{"doc_code":"string","version":2,"section":"string","exact_quote":"string"}]}`;

const REPAIR_SYSTEM = `You are the WorkSense HR Policy Reasoning Agent. Your previous answer failed: it either cited passages that do not exist verbatim in the cited sections, or its JSON was invalid. Fix the answer: keep it truthful, rewrite the citations so every exact_quote is copied VERBATIM from the cited section of the cited document version in the provided excerpts, and respond with valid JSON only. If you cannot support a claim, remove the claim. Never invent policy.
Respond with JSON only:
{"status":"grounded_response|insufficient_evidence","answer":"string","citations":[{"doc_code":"string","version":2,"section":"string","exact_quote":"string"}]}`;

const subMonths = (iso: string, months: number): string => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

interface EmployeeContext {
  id?: string;
  name?: string;
  work_location?: string;
  worker_type?: string;
  tenure_months?: number;
  join_date?: string;
}

/** Enrich citations with the source document metadata they were validated against. */
function enrichCitations(
  citations: { doc_code?: string; version?: number | string; section?: string; exact_quote?: string; claim?: string }[],
  chunks: RetrievedChunk[]
) {
  return citations.map((c) => {
    const ch = chunks.find(
      (x) =>
        String(x.doc_code).toLowerCase() === String(c.doc_code ?? "").toLowerCase() &&
        String(x.section_code) === String(c.section ?? "") &&
        (c.version === undefined || c.version === null || String(x.version ?? "") === String(c.version))
    );
    return {
      ...c,
      doc_title: ch?.doc_title,
      version: ch?.version ?? c.version ?? null,
      heading: ch?.heading,
      effective_from: ch?.effective_from ?? null,
      effective_to: ch?.effective_to ?? null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

    const { data: caller } = await supabase
      .from("digital_twins")
      .select("id, role, email, org_id, name, manager_id, work_location, worker_type, tenure_months")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

    let body: {
      action?: string;
      question?: string;
      employee_id?: string;
      context?: { location?: string; worker_type?: string; taken_days?: number; request_from?: string; request_to?: string };
    } = {};
    try {
      body = await req.json();
    } catch {
      /* empty */
    }

    // ---- context listing (auth only): visible employees + current docs -------
    if (body.action === "context") {
      const { data: twins } = await supabase
        .from("digital_twins")
        .select("id, name, org_id, manager_id, work_location, worker_type, tenure_months")
        .eq("org_id", caller.org_id);
      const employees: EmployeeView[] = (twins ?? []).map((t) => ({
        id: t.id, org_id: t.org_id, name: t.name, manager_id: t.manager_id,
        work_location: t.work_location, worker_type: t.worker_type,
      }));
      const visible = employees.filter((e) => canViewEmployee({ id: caller.id, role: caller.role, org_id: caller.org_id }, e));

      const { data: docRows } = await supabase
        .from("policy_documents")
        .select("id, doc_code, version, title, category, effective_from, effective_to, applicable_locations, applicable_worker_types")
        .eq("org_id", caller.org_id);
      const docs = (docRows ?? []).map((d) => ({
        id: d.id, doc_code: d.doc_code, version: d.version, title: d.title, category: d.category ?? "General",
        effective_from: d.effective_from, effective_to: d.effective_to,
        applicable_locations: d.applicable_locations ?? ["All"], applicable_worker_types: d.applicable_worker_types ?? ["All"],
      }));
      const current = currentVersionSet(
        docs.map((d) => ({ ...d, sections: [] })),
        new Date().toISOString().slice(0, 10)
      );
      return json({ ok: true, employees: visible, policies: current });
    }

    // ---- question answering ----
    const raw = String(body.question ?? "").trim();
    if (raw.length < 5) return json({ error: "VALIDATION_ERROR", message: "Ask a real question (min 5 characters)." }, 400);
    const question = sanitizeUntrusted(raw);
    const asOf = new Date().toISOString().slice(0, 10);

    // 1) Load the policy corpus (org-scoped: the actor only ever sees their org).
    const { data: docRows } = await supabase
      .from("policy_documents")
      .select("id, doc_code, version, title, category, sections, effective_from, effective_to, applicable_locations, applicable_worker_types, supersedes_doc_id")
      .eq("org_id", caller.org_id);
    const policies: PolicyDoc[] = (docRows ?? []).map((r) => ({
      id: r.id,
      doc_code: r.doc_code,
      version: r.version,
      title: r.title,
      category: r.category ?? "General",
      sections: r.sections ?? [],
      effective_from: r.effective_from ?? undefined,
      effective_to: r.effective_to ?? null,
      applicable_locations: r.applicable_locations ?? ["All"],
      applicable_worker_types: r.applicable_worker_types ?? ["All"],
      supersedes_doc_id: r.supersedes_doc_id ?? null,
    }));

    // 2) Resolve employee context (authorized).
    const { data: twins } = await supabase
      .from("digital_twins")
      .select("id, name, org_id, manager_id, work_location, worker_type, tenure_months")
      .eq("org_id", caller.org_id);
    const employees: EmployeeView[] = (twins ?? []).map((t) => ({
      id: t.id, org_id: t.org_id, name: t.name, manager_id: t.manager_id,
      work_location: t.work_location, worker_type: t.worker_type,
    }));
    const callerView: CallerView = { id: caller.id, role: caller.role, org_id: caller.org_id };

    let employeeCtx: EmployeeContext = {};
    const explicitId = (body.employee_id ?? "").trim();
    if (explicitId) {
      const target = employees.find((e) => e.id === explicitId);
      if (!target || !canViewEmployee(callerView, target)) {
        return json({ error: "FORBIDDEN", message: "You cannot access that employee's context." }, 403);
      }
      employeeCtx = {
        id: target.id, name: target.name,
        work_location: target.work_location ?? undefined,
        worker_type: target.worker_type ?? undefined,
        tenure_months: (twins ?? []).find((t) => t.id === target.id)?.tenure_months ?? undefined,
      };
    } else {
      const mention = findEmployeeMention(question, employees, callerView);
      if (mention) {
        employeeCtx = {
          id: mention.id, name: mention.name,
          work_location: mention.work_location ?? undefined,
          worker_type: mention.worker_type ?? undefined,
          tenure_months: (twins ?? []).find((t) => t.id === mention.id)?.tenure_months ?? undefined,
        };
      } else if (caller.role === "employee") {
        employeeCtx = { id: caller.id, name: caller.name, work_location: caller.work_location ?? undefined, worker_type: caller.worker_type ?? undefined, tenure_months: caller.tenure_months ?? undefined };
      }
    }
    // Hypothetical context supplied explicitly overrides the resolved one.
    if (body.context?.location) employeeCtx.work_location = body.context.location;
    if (body.context?.worker_type) employeeCtx.worker_type = body.context.worker_type;
    if (employeeCtx.tenure_months !== undefined) employeeCtx.join_date = subMonths(asOf, employeeCtx.tenure_months);

    const ctx = { location: employeeCtx.work_location, worker_type: employeeCtx.worker_type };

    // 3) Current version set (date window + supersession).
    const currentAll = currentVersionSet(policies, asOf);
    if (currentAll.length === 0) {
      return json({ status: "insufficient_evidence", abstained: true, best_score: 0, threshold: ABSTENTION_THRESHOLD, answer: "", citations: [], retrieval: [], note: "No current policy documents are available in your organization." });
    }

    // 4) Missing applicability fields -> targeted clarification, not assumption.
    const topOfAll = retrieveChunks(currentAll, question, 1)[0];
    if (topOfAll) {
      const doc = currentAll.find((d) => d.doc_code === topOfAll.doc_code);
      if (doc) {
        const missing = missingApplicability(doc, ctx);
        if (missing.length > 0) {
          return json({
            status: "clarification_needed",
            abstained: true,
            best_score: topOfAll.score,
            threshold: ABSTENTION_THRESHOLD,
            answer: "",
            citations: [],
            retrieval: [topOfAll],
            clarification: {
              fields: missing,
              reason: `"${doc.title}" applies to specific ${missing.map((f) => f.replace("_", " ")).join(" and ")}, which were not provided. I will not assume an applicable ${missing.join(" / ")}.`,
              doc_code: doc.doc_code,
              doc_title: doc.title,
            },
            employee_context: employeeCtx,
          });
        }
      }
    }

    // 5) Applicability filter (only when the field is known), then lexical retrieval.
    const applicable = currentAll.filter((d) => applicabilityOk(d, ctx));
    const retrieval = retrieveChunks(applicable, question, 5);

    // 6) Honest context notes: retired policies and applicability-excluded docs.
    const outOfWindow = filterOutOfWindow(policies, asOf);
    const expiredChunks = outOfWindow.length > 0 ? retrieveChunks(outOfWindow, question, 1) : [];
    const expiredHit = expiredChunks[0] ?? null;
    const expiredDoc = expiredHit ? outOfWindow.find((d) => d.doc_code === expiredHit.doc_code) ?? null : null;
    const currentTexts = applicable.flatMap((d) => d.sections.map((s) => s.text));
    const expiredExclusive = expiredHit && expiredDoc
      ? exclusiveQuestionTokens(question, expiredDoc.sections.map((s) => s.text), currentTexts)
      : [];
    const expiredPriority = Boolean(expiredHit && expiredDoc && expiredHit.score >= 0.45 && expiredExclusive.length >= 1);

    const excludedDocs = currentAll.filter((d) => !applicabilityOk(d, ctx));
    const excludedChunks = excludedDocs.length > 0 ? retrieveChunks(excludedDocs, question, 1) : [];
    const excludedHit = excludedChunks[0] ?? null;
    const excludedDoc = excludedHit ? excludedDocs.find((d) => d.doc_code === excludedHit.doc_code) ?? null : null;
    const excludedExclusive = excludedHit && excludedDoc
      ? exclusiveQuestionTokens(question, excludedDoc.sections.map((s) => s.text), currentTexts)
      : [];
    const excludedPriority = Boolean(excludedHit && excludedDoc && excludedHit.score >= 0.45 && excludedExclusive.length >= 1);

    const ctxText = [ctx.location && `location=${ctx.location}`, ctx.worker_type && `worker type=${ctx.worker_type}`].filter(Boolean).join(", ") || "no context provided";

    // Deterministic, honest notes — no model call, nothing invented.
    if (expiredPriority) {
      return json({
        status: "insufficient_evidence",
        abstained: true,
        best_score: retrieval[0]?.score ?? 0,
        threshold: ABSTENTION_THRESHOLD,
        answer: "",
        citations: [],
        retrieval: retrieveChunks([expiredDoc!], question, 2).map((c) => ({ ...c, heading: `${c.heading} [RETIRED ${expiredDoc!.effective_to ?? ""}]` })),
        note: `No current policy covers this. "${expiredDoc!.title}" (${expiredDoc!.doc_code}) was retired on ${expiredDoc!.effective_to ?? "a prior date"} and has no current version — nothing was invented to answer it.`,
        expired_policy: { doc_code: expiredDoc!.doc_code, title: expiredDoc!.title, effective_to: expiredDoc!.effective_to ?? null, score: expiredHit!.score },
        employee_context: employeeCtx,
      });
    }
    if (excludedPriority) {
      return json({
        status: "insufficient_evidence",
        abstained: true,
        best_score: retrieval[0]?.score ?? 0,
        threshold: ABSTENTION_THRESHOLD,
        answer: "",
        citations: [],
        retrieval: retrieveChunks([excludedDoc!], question, 2).map((c) => ({ ...c, heading: `${c.heading} [DOES NOT APPLY — ${ctxText}]` })),
        note: `"${excludedDoc!.title}" (${excludedDoc!.doc_code}) does not apply to ${ctxText || "the given context"}, so it cannot answer this question — nothing was assumed or invented.`,
        excluded_policy: { doc_code: excludedDoc!.doc_code, title: excludedDoc!.title, context: ctx },
        employee_context: employeeCtx,
      });
    }

    // 7) Abstention gate (BM25 score is a ranking signal, not a probability).
    if (retrieval.length === 0 || retrieval[0].score < ABSTENTION_THRESHOLD) {
      return json({
        status: "insufficient_evidence",
        abstained: true,
        best_score: retrieval[0]?.score ?? 0,
        threshold: ABSTENTION_THRESHOLD,
        answer: "",
        citations: [],
        retrieval,
        employee_context: employeeCtx,
      });
    }

    // 8) Deterministic computations where supported (leave balances / spans).
    let computed: unknown = null;
    const topDoc = applicable.find((d) => d.doc_code === retrieval[0].doc_code);
    const isLeaveTopic = retrieval[0].doc_code === "POL-LVE" || /\bleave\b|\bvacation\b|\bcarryover\b|\baccru\w*\b/.test(question);
    if (isLeaveTopic && topDoc && employeeCtx.tenure_months !== undefined && employeeCtx.join_date) {
      const taken = Math.max(0, Number(body.context?.taken_days) || 0);
      const balance = leaveSummary({ join_date: employeeCtx.join_date, taken_days: taken, as_of: asOf });
      let request: unknown = null;
      if (body.context?.request_from && body.context?.request_to && employeeCtx.work_location === "US") {
        request = leaveDaysConsumed({
          from: body.context.request_from,
          to: body.context.request_to,
          public_holidays: US_PUBLIC_HOLIDAYS_2026,
        });
      }
      computed = {
        topic: "leave_balance",
        employee: { name: employeeCtx.name ?? null, work_location: employeeCtx.work_location ?? null, worker_type: employeeCtx.worker_type ?? null },
        balance,
        months_in_leave_year: monthsInLeaveYear(employeeCtx.join_date, asOf),
        request_span: request,
      };
    }

    // 9) One grounded Qwen call, then STRICT citation validation (+ one repair).
    const contextNotes: RetrievedChunk[] = [];
    if (expiredHit && expiredDoc && expiredHit.score >= 0.45) {
      contextNotes.push(...retrieveChunks([expiredDoc], question, 2).map((c) => ({ ...c, heading: `${c.heading} [RETIRED ${expiredDoc.effective_to ?? ""}]` })));
    }
    if (excludedHit && excludedDoc && excludedHit.score >= 0.45) {
      contextNotes.push(...retrieveChunks([excludedDoc], question, 2).map((c) => ({ ...c, heading: `${c.heading} [DOES NOT APPLY — ${ctxText}]` })));
    }
    const fullRetrieval = [...retrieval, ...contextNotes];

    const chunksText = fullRetrieval
      .map((c) => `[${c.doc_code} v${c.version} ${c.section_code}] ${c.heading}${NL}${c.text}`)
      .join(NL + NL);
    const factsBlock = computed
      ? `<authoritative_computed_facts>${NL}${JSON.stringify(computed)}${NL}</authoritative_computed_facts>`
      : "";

    const buildUser = () =>
      `<policy_chunks>${NL}${chunksText}${NL}</policy_chunks>${NL}${NL}${factsBlock}${NL}${NL}Question (untrusted): ${wrapUntrusted(question)}`;

    const attempt = async (repairHint: boolean) => {
      const parsed = (await callQwen({
        json: true,
        temperature: 0.1,
        maxTokens: 1100,
        task: repairHint ? "policy_answer_repair" : "policy_qa",
        system: repairHint ? REPAIR_SYSTEM : GROUNDING_SYSTEM,
        user: buildUser(),
      })) as unknown;
      const valid = validatePolicyAnswer(parsed);
      if (!valid.ok) throw new QwenError("MODEL_OUTPUT_INVALID", `Policy answer failed validation: ${valid.errors.join("; ")}`);
      return parsed as { status?: string; answer?: string; citations?: { doc_code?: string; version?: number; section?: string; exact_quote?: string }[] };
    };

    let typed: { status?: string; answer?: string; citations?: { doc_code?: string; version?: number; section?: string; exact_quote?: string }[] } | null = null;
    let modelNote = "";
    try {
      typed = await attempt(false);
      const { droppedCount } = validateCitations(typed.citations, fullRetrieval);
      if (typed.status === "grounded_response" && droppedCount > 0) {
        typed = await attempt(true);
      }
    } catch (err) {
      if (err instanceof QwenError && err.code === "MODEL_OUTPUT_INVALID") {
        // Repair once; if the repair also fails, abstain honestly.
        try {
          typed = await attempt(true);
        } catch {
          modelNote = "The model could not produce a schema-valid grounded answer; the question was not answered.";
        }
      } else {
        throw err;
      }
    }

    if (!typed) {
      return json({
        status: "insufficient_evidence",
        abstained: false,
        best_score: retrieval[0].score,
        threshold: ABSTENTION_THRESHOLD,
        answer: "",
        citations: [],
        retrieval: fullRetrieval,
        computed,
        employee_context: employeeCtx,
        note: modelNote || "No supported answer was produced.",
      });
    }

    const repaired = validateCitations(typed.citations, fullRetrieval);
    const finalCits = repaired.valid;
    const finalDropped = repaired.droppedCount;

    const answer = String(typed.answer ?? "").trim();
    let status: "grounded" | "partially_supported" | "insufficient_evidence" =
      typed.status === "grounded_response" ? "grounded" : "insufficient_evidence";

    // Never label grounded without a valid citation; never allow dropped claims
    // to silently pass as grounded.
    if (finalCits.length === 0) status = "insufficient_evidence";
    else if (finalDropped > 0) status = "partially_supported";
    if (answer.length === 0) status = "insufficient_evidence";

    if (status === "insufficient_evidence") {
      return json({
        status,
        abstained: false,
        best_score: retrieval[0].score,
        threshold: ABSTENTION_THRESHOLD,
        answer: "",
        citations: [],
        retrieval: fullRetrieval,
        computed,
        employee_context: employeeCtx,
        note: finalCits.length === 0
          ? "The model could not tie the answer to verbatim quotes from the cited sections; it was discarded rather than labeled grounded."
          : "No supported answer was produced.",
      });
    }

    return json({
      status,
      abstained: false,
      best_score: retrieval[0].score,
      threshold: ABSTENTION_THRESHOLD,
      answer,
      citations: enrichCitations(finalCits, fullRetrieval),
      retrieval: fullRetrieval,
      computed,
      employee_context: employeeCtx,
      note: status === "partially_supported"
        ? `Some claims were removed: ${repaired.invalidReasons.slice(0, 2).join(" ")}`
        : undefined,
    });
  } catch (err) {
    return json({ error: err instanceof QwenError ? err.code : "INTERNAL", message: err instanceof Error ? err.message : "unknown" });
  }
});
