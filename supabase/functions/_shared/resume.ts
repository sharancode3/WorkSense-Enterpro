// ---------------------------------------------------------------------------
// WorkSense resume ingestion helpers (Phase 4). Deterministic, shared by the
// resume-import / resume-review / resume-download backend functions.
// Security rules implemented here: content sniffing (never trust the extension),
// safe filenames, size caps, checksum dedup, quote-to-source validation and
// alias normalization against the skill taxonomy. No raw SQL; no client writes.
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MiB demo limit
export const ALLOWED_EXTENSIONS = ["pdf", "docx"];
export const LOW_TEXT_CHARS = 160; // below this the document is treated as scanned/low-text

export type SniffedType = "pdf" | "docx" | "unknown";

/** Detect the real document type from magic bytes, not the file extension. */
export function sniffDocType(bytes: Uint8Array): SniffedType {
  if (bytes.length >= 5) {
    const head = String.fromCharCode(...bytes.slice(0, 5));
    if (head === "%PDF-") return "pdf";
  }
  if (bytes.length >= 4) {
    const pk = [bytes[0], bytes[1], bytes[2], bytes[3]];
    if (pk[0] === 0x50 && pk[1] === 0x4b && (pk[2] === 0x03 || pk[2] === 0x05 || pk[2] === 0x07)) return "docx"; // PK zip
  }
  return "unknown";
}

/** Strip paths/control chars; keep a safe basename with its extension. */
export function sanitizeFileName(raw: string): string {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 0x20 && c !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, 120);
  return cleaned;
}

export function fileSizeMessage(bytes: number): string {
  if (bytes > MAX_FILE_BYTES) return `File is ${(bytes / 1024 / 1024).toFixed(1)} MiB — the limit is 4 MiB.`;
  return "";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GraphSkillRow {
  skill: string;
  aliases?: string[];
}

/** Normalize a claimed skill name against the taxonomy (exact then aliases).
 *  Postgres → PostgreSQL when the alias list says so; never creates duplicates. */
export function normalizeSkillName(graphRows: GraphSkillRow[], claim: string): string {
  const name = String(claim ?? "").trim();
  if (!name) return name;
  const lower = name.toLowerCase();
  const exact = graphRows.find((g) => g.skill.toLowerCase() === lower);
  if (exact) return exact.skill;
  const alias = graphRows.find((g) =>
    (g.aliases ?? []).some((a) => a.trim().toLowerCase() === lower)
  );
  return alias ? alias.skill : name;
}

const normWs = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

/** A quote is valid only if it appears verbatim (whitespace-normalized) in the
 *  source text — the basis for rejecting fabricated quotes at save time. */
export function quoteMatchesSource(quote: string, sourceText: string): boolean {
  const q = normWs(quote);
  if (q.length === 0) return false;
  return normWs(sourceText).includes(q);
}

/** Overlapping date ranges must not double-count experience. Unknown dates stay
 *  unknown (excluded from the computed total). `present` resolves to the clock. */
export function computeTotalYears(
  roles: { title: string; start: string; end: string }[],
  clockIso: string
): { total_years: number; deduped: number; overlap_warnings: string[] } {
  const clock = new Date(clockIso).getTime();
  const parse = (v: string): number | null => {
    const m = /^(\d{4})-(\d{2})/.exec(v ?? "");
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).getTime() : null;
  };
  const intervals: { start: number; end: number; label: string }[] = [];
  const overlap_warnings: string[] = [];
  for (const r of roles) {
    const start = parse(r.start);
    let end = parse(r.end);
    if (r.end === "present" || /present|now|current/i.test(r.end ?? "")) end = clock;
    if (start === null || end === null) {
      if (start === null) overlap_warnings.push(`${r.title}: start date unknown — excluded from the computed total.`);
      continue;
    }
    intervals.push({ start, end, label: r.title });
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; labels: string[] }[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
      last.labels.push(iv.label);
      if (last.labels.length > 1 && !overlap_warnings.some((w) => w.includes("overlapping"))) {
        overlap_warnings.push(`Overlapping dates detected (${last.labels.join(", ")} + ${iv.label}) — experience not double-counted.`);
      }
    } else {
      merged.push({ start: iv.start, end: iv.end, labels: [iv.label] });
    }
  }
  const totalMs = merged.reduce((n, m) => n + Math.max(0, m.end - m.start), 0);
  return {
    total_years: Math.round((totalMs / (365.25 * 86400000)) * 10) / 10,
    deduped: merged.length,
    overlap_warnings,
  };
}
