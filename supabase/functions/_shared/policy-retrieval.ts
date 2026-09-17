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
  effective_date?: string;
  summary?: string;
  sections: { code: string; heading: string; text: string }[];
}

export interface PolicyChunk {
  doc_code: string;
  doc_title: string;
  category: string;
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
        doc_code: p.doc_code,
        doc_title: p.title,
        category: p.category,
        section_code: s.code,
        heading: s.heading,
        text: s.text,
      });
    }
  }
  return chunks;
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
  section?: string;
  exact_quote?: string;
}

/**
 * Every citation's quote must actually appear (fuzzily) in a retrieved chunk.
 * Invalid citations are dropped; returns { valid, droppedCount }.
 */
export function validateCitations(citations: Citation[] | undefined, chunks: RetrievedChunk[]): {
  valid: Citation[];
  droppedCount: number;
} {
  const valid: Citation[] = [];
  let dropped = 0;
  for (const c of citations ?? []) {
    const quote = normalizeForMatch(c.exact_quote ?? "");
    if (!quote) {
      dropped++;
      continue;
    }
    const found = chunks.some((ch) => normalizeForMatch(ch.text).includes(quote));
    if (found && c.doc_code && c.section) {
      valid.push(c);
    } else {
      dropped++;
    }
  }
  return { valid, droppedCount: dropped };
}
