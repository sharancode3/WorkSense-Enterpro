// ---------------------------------------------------------------------------
// WorkSense Qwen gateway client — server-managed config, strict output
// validation, one controlled repair attempt, sanitized telemetry.
// Called ONLY from backend functions. The tunnel URL / credentials never
// ship to the browser.
// ---------------------------------------------------------------------------

function getEnv(name: string, fallback: string): string {
  try {
    const deno = (globalThis as { Deno?: { env?: { get?: (n: string) => string | undefined } } }).Deno;
    const fromDeno = deno?.env?.get?.(name);
    if (fromDeno !== undefined) return fromDeno;
  } catch {
    /* node test env */
  }
  try {
    return (typeof process !== "undefined" ? process.env?.[name] : undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

function getEnvInt(name: string, fallback: number): number {
  const v = Number(getEnv(name, String(fallback)));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

// --- Server-managed settings (env with sane defaults) ----------------------
export const QWEN_BASE_URL = getEnv("QWEN_BASE_URL", "https://evolve-eternity-epidural.ngrok-free.dev/v1").replace(/\/+$/, "");
export const QWEN_MODEL = getEnv("QWEN_MODEL", "qwen3:4b-instruct-2507-q4_K_M");
export const QWEN_API_KEY = getEnv("QWEN_API_KEY", "local");
/** Optional real gateway auth (e.g. "Basic dXNlcjpwYXNz" or "Bearer x") for a protected tunnel. */
export const QWEN_GATEWAY_AUTH = getEnv("QWEN_GATEWAY_AUTH", "");
export const QWEN_TIMEOUT_MS = getEnvInt("QWEN_TIMEOUT_MS", 100000);
export const QWEN_MAX_INPUT_CHARS = getEnvInt("QWEN_MAX_INPUT_CHARS", 8000);
export const QWEN_MAX_TOKENS = getEnvInt("QWEN_MAX_TOKENS", 1600);

export type QwenErrorCode = "MODEL_UNAVAILABLE" | "MODEL_OUTPUT_INVALID" | "VALIDATION_ERROR" | "INPUT_TOO_LARGE";

export class QwenError extends Error {
  constructor(public code: QwenErrorCode, message: string) {
    super(message);
    this.name = "QwenError";
  }
}

// ---------------------------------------------------------------------------
// Untrusted-content handling (resume intake)
// ---------------------------------------------------------------------------

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore\s+(?:(?:all|any|the|your|previous|prior|above|system|developer)\s+)*(?:instructions?|prompts?|rules?|context|messages?|output)\b/gi,
  /\bdisregard\s+(?:(?:all|any|the|your|previous|prior|above|system|developer)\s+)*(?:instructions?|prompts?|rules?|context)\b/gi,
  /\bdo\s+not\s+(?:follow|obey|listen\s+to)\b/gi,
  /\byou\s+are\s+now\b/gi,
  /\bsystem\s+prompt\b/gi,
  /\bdeveloper\s+message\b/gi,
  /\bjailbreak\b/gi,
  /\boverride\s+(?:(?:your|the|system|developer)\s+)*(?:instructions?|rules?|prompt)\b/gi,
  /\bpretend\s+(?:to\s+|that\s+|you\s+)/gi,
  /\bsay\s+you\s+(?:are|have|would|can)\b/gi,
  /\bgive\s+(?:me\s+)?(?:a\s+)?100\s*%?\s*(?:match|fit|score)\b/gi,
  /\balways\s+(?:ignore|follow|obey)\b/gi,
  /\breveal\s+(?:your|the)\s+(?:system|instructions?|prompt)\b/gi,
];

/** Neutralize instruction-like phrases in untrusted resume text. */
export function sanitizeUntrusted(text: string): string {
  let out = String(text ?? "");
  for (const re of INSTRUCTION_PATTERNS) out = out.replace(re, "[redacted]");
  return out.trim();
}

/** Explicit delimiter marking untrusted content for the model. */
export function wrapUntrusted(text: string): string {
  return `<untrusted_input>\n${text}\n</untrusted_input>`;
}

// ---------------------------------------------------------------------------
// Strict JSON extraction — never salvage arbitrary brace substrings blindly.
// ---------------------------------------------------------------------------

export function isHtmlInterstitial(content: string): boolean {
  const head = String(content ?? "").slice(0, 400).trim().toLowerCase();
  return /^<!doctype|^<html|ngrok|502 bad gateway|504 gateway time-out|cloudflare/.test(head);
}

export function extractJsonStrict(content: string): unknown {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) throw new QwenError("MODEL_OUTPUT_INVALID", "qwen: empty completion");
  if (isHtmlInterstitial(trimmed)) {
    throw new QwenError("MODEL_UNAVAILABLE", "qwen: gateway returned an HTML/interstitial response (infrastructure error, not model output).");
  }
  // 1) strict full parse
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  // 2) strip markdown fences
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(fenced);
  } catch {
    /* fall through */
  }
  // 3) balanced object extraction (only if the remainder is clearly a JSON object)
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const candidate = fenced.slice(start, end + 1);
    // Reject if non-whitespace noise precedes the object or trails it.
    const prefixNoise = fenced.slice(0, start).trim();
    const suffixNoise = fenced.slice(end + 1).trim();
    if (prefixNoise.length <= 40 && suffixNoise.length <= 40) {
      try {
        return JSON.parse(candidate);
      } catch {
        throw new QwenError("MODEL_OUTPUT_INVALID", "qwen: unbalanced JSON in response.");
      }
    }
  }
  throw new QwenError("MODEL_OUTPUT_INVALID", `qwen: no valid JSON object in response (${trimmed.slice(0, 160)}…)`);
}

// ---------------------------------------------------------------------------
// Sanitized telemetry — never log raw prompts.
// ---------------------------------------------------------------------------

function logMetric(entry: Record<string, string | number>) {
  console.log(`[qwen] ${Object.entries(entry).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat call
// ---------------------------------------------------------------------------

export async function callQwen(params: {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  task?: string;
  timeoutMs?: number;
}): Promise<unknown> {
  const task = params.task ?? "generic";
  const started = Date.now();
  const inputChars = String(params.user ?? "").length;

  if (inputChars > QWEN_MAX_INPUT_CHARS) {
    logMetric({ task, status: "rejected", reason: "input_too_large", input_chars: inputChars });
    throw new QwenError("INPUT_TOO_LARGE", `Input exceeds the ${QWEN_MAX_INPUT_CHARS} character limit.`);
  }

  const messages: { role: string; content: string }[] = [
    { role: "system", content: params.system },
    { role: "user", content: params.user },
  ];
  const body: Record<string, unknown> = {
    model: QWEN_MODEL,
    messages,
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? QWEN_MAX_TOKENS,
    stream: false,
  };
  if (params.json) body.response_format = { type: "json_object" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${QWEN_API_KEY}`,
  };
  if (QWEN_GATEWAY_AUTH) headers["Authorization"] = QWEN_GATEWAY_AUTH;

  const attempt = async (repairHint: boolean): Promise<unknown> => {
    const controller = new AbortController();
    const timeoutMs = params.timeoutMs ?? QWEN_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(repairHint ? { ...body, messages: [...messages, { role: "user", content: "IMPORTANT: respond with ONLY valid JSON and nothing else. No markdown fences, no prose." }] } : body),
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      throw new QwenError("MODEL_UNAVAILABLE", timedOut ? `qwen: request timed out after ${timeoutMs}ms` : `qwen: network error (is the endpoint reachable?): ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text();
      if (isHtmlInterstitial(text)) {
        throw new QwenError("MODEL_UNAVAILABLE", "qwen: gateway returned an HTML/interstitial response (infrastructure error).");
      }
      throw new QwenError("MODEL_UNAVAILABLE", `qwen: HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new QwenError("MODEL_OUTPUT_INVALID", "qwen: empty completion");
    }
    if (!params.json) return content;

    const usage = data?.usage;
    const latency = Date.now() - started;
    try {
      const parsed = extractJsonStrict(content);
      logMetric({
        task, status: "ok", latency_ms: latency,
        model: QWEN_MODEL, out_chars: content.length,
        tokens_in: usage?.prompt_tokens ?? 0, tokens_out: usage?.completion_tokens ?? 0,
        input_chars: inputChars,
      });
      return parsed;
    } catch (err) {
      if (err instanceof QwenError) {
        if (err.code === "MODEL_OUTPUT_INVALID" && !repairHint) {
          // Exactly one controlled repair attempt.
          logMetric({ task, status: "repair", latency_ms: latency, reason: err.message.slice(0, 80) });
          return attempt(true);
        }
        logMetric({ task, status: "failed", latency_ms: latency, code: err.code });
        throw err;
      }
      throw err;
    }
  };

  return attempt(false);
}
