// ---------------------------------------------------------------------------
// WorkSense Qwen client — external OpenAI-compatible endpoint, called ONLY
// from backend functions. The model never computes scores; it only extracts
// structured data / writes rubric text. Resume text is treated as UNTRUSTED
// input: instruction-like phrases are neutralized and the content is wrapped
// in an explicit untrusted delimiter before any model call.
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
    const fromNode = (typeof process !== "undefined" ? process.env?.[name] : undefined) ?? fallback;
    return fromNode;
  } catch {
    return fallback;
  }
}

export const QWEN_BASE_URL = getEnv(
  "QWEN_BASE_URL",
  "https://evolve-eternity-epidural.ngrok-free.dev/v1"
).replace(/\/+$/, "");
export const QWEN_MODEL = getEnv("QWEN_MODEL", "qwen3:4b-instruct-2507-q4_K_M");
export const QWEN_API_KEY = getEnv("QWEN_API_KEY", "local");

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
  for (const re of INSTRUCTION_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  return out.trim();
}

/** Explicit delimiter marking untrusted content for the model. */
export function wrapUntrusted(text: string): string {
  return `<untrusted_input>\n${text}\n</untrusted_input>`;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat call
// ---------------------------------------------------------------------------

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  // Strip markdown fences if present.
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`qwen: no JSON object in response: ${content.slice(0, 200)}`);
  }
  return JSON.parse(fenced.slice(start, end + 1));
}

export async function callQwen(params: {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: QWEN_MODEL,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? 1600,
    stream: false,
  };
  if (params.json) {
    body.response_format = { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`qwen: network error (is the endpoint reachable?): ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`qwen: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("qwen: empty completion");
  }
  if (params.json) {
    return extractJson(content);
  }
  return content;
}
