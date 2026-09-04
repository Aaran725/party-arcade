// Tried in order — iOS Safari's MediaRecorder audio support is real but format-limited
// (historically only audio/mp4), unlike Chrome/Android which supports opus containers.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? null;
}

/** Checked once before offering a record button — some devices/browsers can't record audio at all. */
export function audioRecordingSupported(): boolean {
  return pickMimeType() !== null;
}

/**
 * Records one short clip on demand — a different capture pathway from mic-level.ts's
 * continuous on-device amplitude stream (Scream Royale). Here the raw clip itself is the
 * payload: it's sent to the server for Groq speech-to-text, one clip per turn, never a
 * live stream.
 */
export class AudioRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  /** Must be called from inside a user-gesture handler (e.g. a button press) on iOS. */
  async start(): Promise<boolean> {
    const mimeType = pickMimeType();
    if (!mimeType) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.recorder = new MediaRecorder(this.stream, { mimeType });
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.recorder.start();
      return true;
    } catch {
      return false;
    }
  }

  /** Resolves with a data: URL once recording finishes flushing, or null if nothing was captured. Safe to call at most once per start(). */
  stop(): Promise<string | null> {
    const recorder = this.recorder;
    const stream = this.stream;
    const chunks = this.chunks;
    this.recorder = null;
    this.stream = null;

    return new Promise((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        stream?.getTracks().forEach((t) => t.stop());
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      };
      recorder.stop();
    });
  }
}
