import { EdgeTTS } from "edge-tts-universal";

// Microsoft Edge's own "Read aloud" TTS service, reached through the open-source edge-tts
// wrapper — genuinely free, no API key, no account, no credit card (unlike Google Cloud
// TTS, which requires billing to be enabled even to use its free tier). Verified live
// during development: a real request returns real MP3 audio in well under a second.
const VOICE = "en-US-EmmaMultilingualNeural";

/**
 * Synthesizes speech for the AI Game Leader. Returns a data:audio/mpeg;base64,... URL, or
 * null on any failure — the caller (AIHost.speak()) just skips speaking that line rather
 * than blocking the party.
 */
export async function textToSpeech(text: string): Promise<string | null> {
  try {
    const tts = new EdgeTTS(text, VOICE);
    const result = await tts.synthesize();
    const buffer = Buffer.from(await result.audio.arrayBuffer());
    if (buffer.length === 0) throw new Error("edge-tts returned empty audio");
    return `data:audio/mpeg;base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error("[edge-tts] request failed:", err);
    return null;
  }
}
