import { SimliClient, LogLevel } from "simli-client";

const SAMPLE_RATE_HZ = 16_000; // Simli requires mono PCM16 at exactly this rate
const CHUNK_BYTES = 8192; // sent in pieces rather than one giant array, standard WebRTC data-channel practice
const CONNECT_TIMEOUT_MS = 15_000;
const SPEAK_TIMEOUT_MS = 20_000; // safety cap in case the "silent" event never fires

/**
 * server/ai/textToSpeech.ts hands back MP3 (edge-tts's native output format) — decode it
 * via the browser's own AudioContext, mix to mono, resample to 16kHz, and convert to
 * signed 16-bit PCM, matching the exact format Simli's sendAudioData() expects.
 */
async function mp3DataUrlToPcm16(dataUrl: string): Promise<Uint8Array> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE_HZ });
  try {
    const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
    const { length, numberOfChannels } = audioBuffer;
    let mono: Float32Array;
    if (numberOfChannels === 1) {
      mono = audioBuffer.getChannelData(0);
    } else {
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      mono = new Float32Array(length);
      for (let i = 0; i < length; i++) mono[i] = (left[i] + right[i]) / 2;
    }

    const pcm16 = new Uint8Array(length * 2);
    const view = new DataView(pcm16.buffer);
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, mono[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return pcm16;
  } finally {
    void audioCtx.close();
  }
}

/**
 * Wraps Simli's real-time avatar: a WebRTC video stream (LiveKit transport mode — chosen
 * specifically because it needs only a session token, no ICE-server fetch that would
 * otherwise require the raw API key client-side) rendered into a <video> element, driven by
 * PCM16 audio decoded from the MP3 this app generates via edge-tts. The session token comes
 * from the server (server/ai/simliSession.ts), which holds the real SIMLI_API_KEY — that
 * secret never reaches the browser bundle. Used only during party-mode transitions (see
 * DisplayRouter) — the Leader isn't a per-game module, so this doesn't go through
 * GameStage/DisplayGameModule at all.
 *
 * Every failure mode (no credentials, no session, connection drops) is caught and turns into
 * a no-op rather than breaking the party — mount() returns false and speak() resolves
 * immediately so the existing silent flow just keeps working.
 */
export class AIHost {
  private client: InstanceType<typeof SimliClient> | null = null;
  private audioEl: HTMLAudioElement | null = null;
  // Tracks the host's volume choice independently of the autoplay-unlock `.muted` toggle
  // below (that one's purely about getting playback started at all) — applied to `.volume`
  // instead, so HostControls' slider survives mount()'s own muted->unmuted dance.
  private volume = 1;
  private hostMuted = false;
  // Serializes speak() calls — without this, a second call arriving while the first is
  // still playing races it (both attach their own speaking/silent listeners to the same
  // client and push audio concurrently), so the two lines overlap instead of playing in
  // order. Chaining onto this Promise instead of firing immediately fixes that.
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private requestSpeech: (text: string) => Promise<string | null>,
    private requestSession: () => Promise<string | null>,
  ) {}

  /** Mirrors HostControls' master volume control — 0-1, applied immediately if the avatar is already speaking through a live <audio> element. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audioEl) this.audioEl.volume = this.hostMuted ? 0 : this.volume;
  }

  setMuted(muted: boolean): void {
    this.hostMuted = muted;
    if (this.audioEl) this.audioEl.volume = muted ? 0 : this.volume;
  }

  /** Must be called from inside a user-gesture handler (the "Start the party" click) — same browser-audio-unlock constraint every other permission screen in this app already follows (see EnableMicScreen.ts, EnableCameraScreen.ts). */
  async mount(container: HTMLElement): Promise<boolean> {
    try {
      const sessionToken = await this.requestSession();
      if (!sessionToken) throw new Error("no Simli session token available");

      const video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      // Muted — not for silence, Simli already delivers speech through the separate
      // <audio> element below. Browsers block unmuted <video> autoplay once there's any
      // async delay between the triggering click and the track attaching (there always is
      // here: a session-token fetch + WebRTC negotiation), which without this left the
      // avatar frozen on its first frame instead of animating.
      video.muted = true;
      video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
      const audio = document.createElement("audio");
      audio.autoplay = true;
      // Same reasoning as the video: start muted to guarantee autoplay isn't blocked by
      // the async gap between the click and the track attaching, then unmute once the
      // connection is confirmed live — browsers treat unmuting already-playing media far
      // more permissively than starting unmuted playback cold.
      audio.muted = true;
      container.replaceChildren(video, audio);

      const client = new SimliClient(sessionToken, video, audio, null, LogLevel.ERROR, "livekit");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("avatar connection timed out")), CONNECT_TIMEOUT_MS);
        const settle = () => {
          clearTimeout(timeout);
          resolve();
        };
        const onError = (detail: string) => {
          clearTimeout(timeout);
          reject(new Error(detail));
        };
        client.on("error", onError);
        client.on("startup_error", onError);
        // client.start()'s own promise doesn't reliably resolve even once the stream is
        // genuinely live (confirmed directly against Simli's real servers during
        // development) — video_info firing is a more reliable "the avatar actually
        // negotiated" signal, so treat that as connected rather than waiting on start().
        client.on("video_info", settle);
        client.start().catch(onError);
      });
      audio.muted = false;
      video.muted = false;
      audio.volume = this.hostMuted ? 0 : this.volume;

      this.client = client;
      this.audioEl = audio;
      return true;
    } catch (err) {
      console.error("[ai-host] mount failed — party continues without the avatar:", err);
      this.client = null;
      return false;
    }
  }

  /** Resolves once the avatar finishes speaking this line (queued behind any speak() already in flight), or immediately if the host isn't mounted or TTS failed. */
  speak(text: string): Promise<void> {
    const run = this.queue.then(() => this.speakNow(text));
    this.queue = run.catch(() => {}); // one failed line must not jam the queue for whatever's after it
    return run;
  }

  private async speakNow(text: string): Promise<void> {
    if (!this.client) return;
    const audioData = await this.requestSpeech(text);
    if (!audioData) return;

    const pcm = await mp3DataUrlToPcm16(audioData);
    const client = this.client;

    await new Promise<void>((resolve) => {
      let startedSpeaking = false;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        client.off("speaking", onSpeaking);
        client.off("silent", onSilent);
        resolve();
      };
      const onSpeaking = () => {
        startedSpeaking = true;
      };
      // Only treat "silent" as completion once we've actually seen "speaking" — silent also
      // fires (harmlessly) before any audio has been sent at all.
      const onSilent = () => {
        if (startedSpeaking) finish();
      };
      client.on("speaking", onSpeaking);
      client.on("silent", onSilent);

      for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
        client.sendAudioData(pcm.slice(offset, offset + CHUNK_BYTES));
      }

      setTimeout(finish, SPEAK_TIMEOUT_MS);
    });
  }

  unmount(): void {
    void this.client?.stop();
    this.client = null;
    this.audioEl = null;
    this.queue = Promise.resolve(); // drop anything still queued — a new mount shouldn't inherit a stale backlog
  }
}
