// Every sound in this app is synthesized via Web Audio — no audio files, no asset
// pipeline. One shared AudioContext (games never run concurrently), unlocked lazily
// from an existing user-gesture handler (see unlockAudio() callers).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let masterVolume = 0.5;
let masterMuted = false;

function ensure(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = masterMuted ? 0 : masterVolume;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Call from an existing user-gesture handler. Idempotent — safe to call repeatedly. */
export function unlockAudio(): void {
  const c = ensure();
  if (c.state === "suspended") void c.resume();
}

/** Host volume control (HostControls' slider) — only ever called from the Display, so this only ever affects the TV's own synth SFX, never a phone's. 0-1. */
export function setMasterVolume(volume: number): void {
  masterVolume = Math.max(0, Math.min(1, volume));
  if (master && !masterMuted) master.gain.value = masterVolume;
}

export function setMasterMuted(muted: boolean): void {
  masterMuted = muted;
  if (master) master.gain.value = muted ? 0 : masterVolume;
}

export function getMasterVolume(): number {
  return masterVolume;
}

export function getMasterMuted(): boolean {
  return masterMuted;
}

interface ToneOpts {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
}

export function playTone(opts: ToneOpts): void {
  if (!ctx || !master) return; // not unlocked yet — safe no-op, never throws
  const { freq, duration, type = "sine", gain = 0.28, attack = 0.006 } = opts;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

export function playSweep(opts: { fromFreq: number; toFreq: number; duration: number; type?: OscillatorType; gain?: number }): void {
  if (!ctx || !master) return;
  const { fromFreq, toFreq, duration, type = "sawtooth", gain = 0.22 } = opts;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(fromFreq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), now + duration);
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const len = c.sampleRate; // 1s of noise, reused and truncated per-call via playback duration
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

export function playNoiseBurst(opts: { duration: number; gain?: number; filterFreq?: number; filterQ?: number }): void {
  if (!ctx || !master) return;
  const { duration, gain = 0.3, filterFreq = 1200, filterQ = 1 } = opts;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(now);
  src.stop(now + duration + 0.05);
}

export function playChime(freqs: number[], opts?: { noteDuration?: number; gap?: number; type?: OscillatorType; gain?: number }): void {
  const { noteDuration = 0.14, gap = 0.06, type = "triangle", gain = 0.28 } = opts ?? {};
  freqs.forEach((freq, i) => {
    setTimeout(() => playTone({ freq, duration: noteDuration, type, gain }), i * (noteDuration + gap) * 1000);
  });
}

/** The semantic layer games actually call, so seven callsites don't reinvent envelope math. */
export const sfx = {
  uiTap(): void {
    playTone({ freq: 880, duration: 0.06, gain: 0.16 });
  },
  hit(pitchBoost = 0): void {
    playTone({ freq: 520 + pitchBoost * 30, duration: 0.12, type: "square", gain: 0.24 });
  },
  miss(): void {
    playTone({ freq: 140, duration: 0.22, type: "sawtooth", gain: 0.26 });
  },
  countdownTick(urgent = false): void {
    playTone({ freq: urgent ? 1000 : 700, duration: 0.05, type: "square", gain: urgent ? 0.28 : 0.16 });
  },
  roundStart(): void {
    playSweep({ fromFreq: 300, toFreq: 700, duration: 0.25, gain: 0.18 });
  },
  comboTick(streak: number): void {
    playTone({ freq: 440 + Math.min(streak, 8) * 60, duration: 0.08, type: "triangle", gain: 0.2 });
  },
  gameOverFanfare(): void {
    playChime([523.25, 659.25, 783.99], { noteDuration: 0.16, gap: 0.05, gain: 0.3 });
  },
  tone(freq: number, opts?: Partial<ToneOpts>): void {
    playTone({ freq, duration: 0.22, gain: 0.28, ...opts });
  },
};
