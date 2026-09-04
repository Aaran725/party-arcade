import "../env"; // side-effect: populates process.env.GROQ_API_KEY* from .env, if present

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const REQUEST_TIMEOUT_MS = 10_000;

const GROQ_KEYS = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3].filter(
  (k): k is string => !!k,
);

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Defense-in-depth beyond reasoning_effort:"none" — strips a <think>...</think> block
 * and/or markdown code fences if the model ever emits them anyway, then extracts the
 * first {...} object rather than assuming the whole string is clean JSON.
 */
export function extractJson(content: string): unknown {
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

/** POSTs to a Groq endpoint and throws on a non-OK response (including 429) — pair with withGroqKeyRotation. */
export async function fetchGroq(path: string, init: RequestInit): Promise<Response> {
  const res = await fetchWithTimeout(`${GROQ_BASE_URL}${path}`, init, REQUEST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`groq responded ${res.status}`);
  return res;
}

/**
 * Runs `attempt` once per configured Groq API key (rate-limit/outage resilience — the
 * user provided up to 3), stopping at the first one that resolves. `attempt` should throw
 * on any failure worth retrying with a different key — a non-OK response (fetchGroq
 * already does this), a malformed/unparseable body, or a response missing the field the
 * caller needs. Returns null if every key fails or none are configured, so callers can
 * fall back locally instead of hanging or breaking a live round.
 */
export async function withGroqKeyRotation<T>(attempt: (key: string) => Promise<T>): Promise<T | null> {
  if (GROQ_KEYS.length === 0) return null;
  for (const key of GROQ_KEYS) {
    try {
      return await attempt(key);
    } catch (err) {
      console.error("[groq] request failed, trying next key/fallback:", err);
    }
  }
  return null;
}
