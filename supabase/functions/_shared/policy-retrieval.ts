// ---------------------------------------------------------------------------
// WorkSense Grounded Policy engine — DETERMINISTIC retrieval, zero LLM.
//  - paragraph-level policy chunks (stable doc_code + section heading)
//  - BM25-style relevance scoring (no LLM credits)
//  - calibrated abstention gate evaluated BEFORE any model call
//  - citation validator so an ungrounded answer can never slip through
// ---------------------------------------------------------------------------

export interface PolicyDoc {
  id: string;
  title: string;
  category: string;
  doc_code: string;
  version?: number;
  effective_date?: string;
  effective_from?: string;
  effective_to?: string | null;
  applicable_locations?: string[];
  applicable_worker_types?: string[];
  supersedes_doc_id?: string | null;
  summary?: string;
  sections: { code: string; heading: string; text: string }[];
}

export interface PolicyChunk {
  doc_code: string;
  doc_title: string;
  category: string;
  doc_id?: string;
  version?: number;
  effective_from?: string;
  effective_to?: string | null;
  section_code: string;
  heading: string;
  text: string;
}

export interface RetrievedChunk extends PolicyChunk {
  score: number;
}

/** Calibrated on the seeded policy corpus. Questions below this skip the LLM. */
export const ABSTENTION_THRESHOLD = 0.75;

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "with", "is", "are", "be", "at",
  "by", "from", "as", "it", "its", "i", "you", "your", "we", "our", "can", "may", "must", "will",
  "not", "no", "that", "this", "these", "those", "per", "up", "over", "if", "when", "who", "what",
  "which", "how", "do", "does", "did", "have", "has", "had", "would", "should", "could", "about",
  "all", "any", "each", "every", "more", "most", "other", "some", "such", "than", "then", "there",
  "they",   "their", "into", "within", "after", "before", "during", "between", "out", "off", "under",
  "above", "does", "s", "t",
]);

export function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function flattenPolicies(policies: PolicyDoc[]): PolicyChunk[] {
  const chunks: PolicyChunk[] = [];
  for (const p of policies) {
    for (const s of p.sections) {
      chunks.push({
        doc_id: p.id,
        doc_code: p.doc_code,
        doc_title: p.title,
        category: p.category,
        version: p.version,
        effective_from: p.effective_from ?? p.effective_date,
        effective_to: p.effective_to ?? null,
        section_code: s.code,
        heading: s.heading,
        text: s.text,
      });
    }
  }
  return chunks;
}

export interface EmployeePolicyContext {
  location?: string;
  worker_type?: string;
}

/** Normalize an applicability list; "All" matches anything. */
function appliesTo(list: string[] | undefined, value: string | undefined): boolean {
  if (!value) return true; // unknown field: do not filter (clarification handles it)
  const norm = (v: string) => v.trim().toLowerCase();
  const arr = (list ?? ["All"]).map(norm);
  return arr.includes("all") || arr.includes(norm(value));
}

/** Is the document applicable given the known employee context? Unknown fields
 *  are treated as "not ruled out" — the missing-field logic decides if we must
 *  clarify instead of assume. */
export function applicabilityOk(doc: PolicyDoc, ctx: EmployeePolicyContext): boolean {
  return appliesTo(doc.applicable_locations, ctx.location) && appliesTo(doc.applicable_worker_types, ctx.worker_type);
}

/** Which applicability fields are missing but required by the document? */
export function missingApplicability(doc: PolicyDoc, ctx: EmployeePolicyContext): string[] {
  const missing: string[] = [];
  const needsLocation = (doc.applicable_locations ?? []).length > 0 && !(doc.applicable_locations ?? []).map((v) => v.trim().toLowerCase()).includes("all");
  const needsWorker = (doc.applicable_worker_types ?? []).length > 0 && !(doc.applicable_worker_types ?? []).map((v) => v.trim().toLowerCase()).includes("all");
  if (needsLocation && !ctx.location) missing.push("location");
  if (needsWorker && !ctx.worker_type) missing.push("worker_type");
  return missing;
}

/** Date-window filter: keep docs effective on `asOf`. */
export function filterByWindow(policies: PolicyDoc[], asOf: string): PolicyDoc[] {
  const t = new Date(asOf).getTime();
  return (policies ?? []).filter((p) => {
    const from = p.effective_from ?? p.effective_date;
    if (from && new Date(from).getTime() > t) return false;
    if (p.effective_to && new Date(p.effective_to).getTime() < t) return false;
    return true;
  });
}

/** Docs that fell OUTSIDE the window (used for honest "expired/retired" notes). */
export function filterOutOfWindow(policies: PolicyDoc[], asOf: string): PolicyDoc[] {
  const t = new Date(asOf).getTime();
  return (policies ?? []).filter((p) => {
    const from = p.effective_from ?? p.effective_date;
    if (from && new Date(from).getTime() > t) return true;
    if (p.effective_to && new Date(p.effective_to).getTime() < t) return true;
    return false;
  });
}

/**
 * Resolve the CURRENT version set for an as-of date:
 *  - drop documents outside the date window,
 *  - keep the newest version per doc_code,
 *  - drop documents explicitly superseded by a current document.
 */
export function currentVersionSet(policies: PolicyDoc[], asOf: string): PolicyDoc[] {
  const inWindow = filterByWindow(policies, asOf);
  const byCode = new Map<string, PolicyDoc>();
  for (const doc of inWindow) {
    const cur = byCode.get(doc.doc_code);
    if (!cur || (doc.version ?? 1) > (cur.version ?? 1)) byCode.set(doc.doc_code, doc);
  }
  const current = [...byCode.values()];
  const supersededIds = new Set(
    current.filter((d) => d.supersedes_doc_id).map((d) => d.supersedes_doc_id as string)
  );
  return current.filter((d) => !supersededIds.has(d.id));
}

const K1 = 1.2;
const B = 0.75;

/** Classic BM25 over the flattened chunk corpus. */
export function retrieveChunks(policies: PolicyDoc[], question: string, topK = 3): RetrievedChunk[] {
  const chunks = flattenPolicies(policies);
  const N = chunks.length;
  const avgdl = chunks.reduce((s, c) => s + tokenize(c.text).length, 0) / Math.max(1, N);
  const queryTerms = tokenize(question);

  // document frequency per term
  const df = new Map<string, number>();
  const docTokens = chunks.map((c) => {
    const tokens = tokenize(c.text);
    const uniq = new Set(tokens);
    for (const t of uniq) df.set(t, (df.get(t) ?? 0) + 1);
    return tokens;
  });

  const idf = (term: string) => Math.log(1 + (N - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));

  const scored: RetrievedChunk[] = chunks.map((c, i) => {
    const tokens = docTokens[i];
    const dl = tokens.length;
    let score = 0;
    for (const t of queryTerms) {
      const tf = tokens.filter((x) => x === t).length;
      if (tf === 0) continue;
      score += ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / avgdl))) * idf(t);
    }
    return { ...c, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** Fuzzy normalization for quote matching (whitespace + case insensitive). */
export function normalizeForMatch(s: string): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface Citation {
  claim?: string;
  doc_code?: string;
  version?: number | string;
  section?: string;
  exact_quote?: string;
}

export interface CitationValidation {
  valid: Citation[];
  droppedCount: number;
  invalidReasons: string[];
}

/**
 * STRICT citation validation (Phase 7): every exact_quote must appear in the
 * cited SECTION of the cited DOCUMENT — existing verbatim somewhere in the
 * retrieved chunks is NOT sufficient (source identity + claim support).
 * A version may be omitted, in which case any version of the doc_code matches.
 * Invalid citations are dropped with a reason; callers repair once or abstain.
 */
export function validateCitations(
  citations: Citation[] | undefined,
  chunks: RetrievedChunk[]
): CitationValidation {
  const valid: Citation[] = [];
  const invalidReasons: string[] = [];
  let dropped = 0;

  const hasExactSection = (c: Citation, quote: string): boolean =>
    chunks.some((ch) => {
      if (String(ch.doc_code).toLowerCase() !== String(c.doc_code ?? "").toLowerCase()) return false;
      if (String(ch.section_code) !== String(c.section ?? "")) return false;
      if (c.version !== undefined && c.version !== null && String(ch.version ?? "") !== String(c.version)) return false;
      return normalizeForMatch(ch.text).includes(quote);
    });

  for (const c of citations ?? []) {
    const quote = normalizeForMatch(c.exact_quote ?? "");
    if (!quote) {
      dropped++;
      invalidReasons.push("Citation has an empty exact_quote.");
      continue;
    }
    if (!c.doc_code || !c.section) {
      dropped++;
      invalidReasons.push("Citation is missing doc_code or section.");
      continue;
    }
    if (hasExactSection(c, quote)) {
      valid.push(c);
    } else {
      dropped++;
      invalidReasons.push(`Quote not found in the cited section ${c.doc_code} ${c.section}: "${String(c.exact_quote ?? "").slice(0, 80)}"`);
    }
  }
  return { valid, droppedCount: dropped, invalidReasons };
}

/** Highest-scoring match against documents that fell out of the date window —
 *  used to say "this policy was retired on <date>" instead of inventing. */
export function bestExpiredHit(policies: PolicyDoc[], question: string, asOf: string): {
  doc_code: string;
  title: string;
  effective_to: string | null;
  score: number;
} | null {
  const out = filterOutOfWindow(policies, asOf);
  if (out.length === 0) return null;
  const res = retrieveChunks(out, question, 1);
  if (res.length === 0) return null;
  return {
    doc_code: res[0].doc_code,
    title: res[0].doc_title,
    effective_to: res[0].effective_to ?? null,
    score: res[0].score,
  };
}

/**
 * Question tokens that appear in `candidateTexts` but in NONE of `otherTexts`.
 * Used to distinguish "this question is really about the expired/excluded
 * document" from "the question only shares generic words (e.g. reimbursement)
 * with a still-current document".
 */
export function exclusiveQuestionTokens(question: string, candidateTexts: string[], otherTexts: string[]): string[] {
  const q = new Set(tokenize(question));
  const cand = new Set(candidateTexts.flatMap((t) => tokenize(t)));
  const others = new Set(otherTexts.flatMap((t) => tokenize(t)));
  return [...q].filter((t) => cand.has(t) && !others.has(t));
}

// ---------------------------------------------------------------------------
// Phase 9: precedence + conflict handling.
// ---------------------------------------------------------------------------

/** A policy that is in contention for a question (one best chunk per doc). */
export interface PolicyConflictCandidate {
  doc_code: string;
  title: string;
  version: number | undefined;
  section_code: string;
  heading: string;
  score: number;
  effective_from: string | null;
  effective_to: string | null;
}

/**
 * Phase 9 (items 4-5): detect when TWO or more CURRENT, applicable policies are
 * NEARLY TIED for the question — i.e. the second-best family is within a tight
 * ratio of the best. When two different policies match almost equally well,
 * choosing one would be arbitrary, so the caller surfaces the conflict instead
 * of silently picking. A clearly-dominant policy (e.g. the leave doc for an
 * annual-leave question) is not a conflict. Location/worker-type variants
 * (POL-LVE vs POL-LVE-EU) share one family and are resolved by applicability.
 */
export function policyFamily(docCode: string): string {
  return String(docCode ?? "").replace(/-(EU|US|UK|CA|DE|FR|IN|APAC)$/i, "");
}

/** Near-tie ratio: a second family within this fraction of the best is in
 *  contention for the same answer. */
export const CONFLICT_NEAR_TIE_RATIO = 0.9;

export function detectPolicyConflict(
  applicable: PolicyDoc[],
  question: string,
  minScore: number,
  topN = 8
): PolicyConflictCandidate[] {
  const chunks = retrieveChunks(applicable, question, topN);
  const bestByFamily = new Map<string, RetrievedChunk>();
  for (const c of chunks) {
    const family = policyFamily(c.doc_code);
    const cur = bestByFamily.get(family);
    if (!cur || c.score > cur.score) bestByFamily.set(family, c);
  }
  const sorted = [...bestByFamily.values()].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  if (!best || best.score < minScore) return [];
  const contenders = sorted.filter(
    (c) => c.score >= CONFLICT_NEAR_TIE_RATIO * best.score && c.score >= 0.5
  );
  return contenders.map((c) => ({
    doc_code: c.doc_code,
    title: c.doc_title,
    version: c.version,
    section_code: c.section_code,
    heading: c.heading,
    score: +c.score.toFixed(3),
    effective_from: c.effective_from ?? null,
    effective_to: c.effective_to ?? null,
  }));
}

/**
 * Phase 9 (item 4): deterministic precedence when multiple current policies
 * could apply — more specific applicability first, then newer effective date,
 * then doc_code as a stable tiebreaker.
 */
export function resolvePrecedence(policies: PolicyDoc[]): PolicyDoc[] {
  const specificity = (d: PolicyDoc): number => {
    const locs = (d.applicable_locations ?? []).filter((l) => l.toLowerCase() !== "all").length;
    const types = (d.applicable_worker_types ?? []).filter((t) => t.toLowerCase() !== "all").length;
    return locs + types;
  };
  return [...(policies ?? [])].sort((a, b) => {
    const s = specificity(b) - specificity(a);
    if (s !== 0) return s;
    const d = new Date(b.effective_from ?? b.effective_date ?? 0).getTime() - new Date(a.effective_from ?? a.effective_date ?? 0).getTime();
    if (d !== 0) return d;
    return String(a.doc_code).localeCompare(String(b.doc_code));
  });
}
