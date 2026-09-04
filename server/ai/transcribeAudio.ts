import { fetchGroq, withGroqKeyRotation } from "./groqClient";

// Verify at console.groq.com/docs/speech-to-text if calls start failing — Groq's hosted
// Whisper offering has moved between model ids before; a wrong/retired id just makes
// every transcription fail gracefully into "nothing heard" for that turn, never a crash.
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header.match(/data:(.*);base64/)?.[1] ?? "audio/webm";
  const binary = Buffer.from(base64 ?? "", "base64");
  return { blob: new Blob([binary], { type: mimeType }), mimeType };
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * Transcribes one short recorded clip via Groq's Whisper endpoint. Returns null on total
 * failure OR if nothing recognizable was said — Echo Chain treats both the same way (that
 * turn's player is eliminated), so there's no need to distinguish them for the caller.
 */
export async function transcribeAudio(audioDataUrl: string): Promise<string | null> {
  const { blob, mimeType } = dataUrlToBlob(audioDataUrl);
  const result = await withGroqKeyRotation(async (key) => {
    const form = new FormData();
    form.append("file", blob, `clip.${extensionFor(mimeType)}`);
    form.append("model", GROQ_WHISPER_MODEL);
    const res = await fetchGroq("/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const json = await res.json();
    if (typeof json.text !== "string") throw new Error("groq response missing text");
    return json.text.trim();
  });
  return result && result.length > 0 ? result : null;
}
