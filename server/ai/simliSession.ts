import "../env"; // side-effect: populates process.env.SIMLI_API_KEY from .env, if present

const SIMLI_URL = "https://api.simli.ai";
const REQUEST_TIMEOUT_MS = 10_000;

// One of Simli's own published preset faces (docs.simli.com/api-reference/preset-faces) —
// "Madison" — swap for your own once you've picked/built one on simli.com.
const DEFAULT_FACE_ID = "5fc23ea5-8175-4a82-aaaf-cdd8c88543dc";

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
 * Mints a short-lived Simli session token server-side, so the real SIMLI_API_KEY never
 * reaches the browser bundle — unlike the raw secret, a leaked session token is scoped to
 * one session and expires. Replicates exactly what simli-client's own generateSimliSessionToken()
 * does internally (POST /compose/token) rather than importing that package here, since it's
 * a browser-oriented WebRTC client with browser-only dependencies.
 */
export async function createAvatarSession(): Promise<string | null> {
  const apiKey = process.env.SIMLI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetchWithTimeout(
      `${SIMLI_URL}/compose/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-simli-api-key": apiKey },
        body: JSON.stringify({
          faceId: DEFAULT_FACE_ID,
          handleSilence: true,
          maxSessionLength: 600,
          maxIdleTime: 180,
        }),
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!res.ok) throw new Error(`simli responded ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (typeof json.session_token !== "string") throw new Error("simli response missing session_token");
    return json.session_token;
  } catch (err) {
    console.error("[simli] session token request failed:", err);
    return null;
  }
}
