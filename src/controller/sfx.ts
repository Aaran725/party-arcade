import { playTone } from "@shared/audio";

/**
 * Small, purpose-named wrappers around the shared Web Audio synth (src/shared/audio.ts —
 * the same "synthesized, not loaded" approach the Display's own sfx module already uses).
 * Only called from haptics.ts's vibrate() — every controller interaction that deserves
 * haptic feedback already calls vibrate() at exactly the right moment, so pairing sound
 * with vibration there gives systematic coverage across all 16 games without touching any
 * per-game render logic.
 */
export const sfx = {
  tap(): void {
    playTone({ freq: 720, duration: 0.045, type: "sine", gain: 0.14 });
  },
  submit(): void {
    playTone({ freq: 520, duration: 0.09, type: "triangle", gain: 0.18 });
  },
  success(): void {
    playTone({ freq: 660, duration: 0.16, type: "triangle", gain: 0.22 });
    setTimeout(() => playTone({ freq: 880, duration: 0.18, type: "triangle", gain: 0.22 }), 90);
  },
  // The wave travels around the room in join order — each phone plays a slightly higher
  // note than the one before it, so the sequence reads as one ascending run rather than
  // N copies of the same beep. Capped so a big room doesn't run off into ultrasonic territory.
  wave(staggerIndex = 0): void {
    const freq = 660 + Math.min(staggerIndex, 14) * 34;
    playTone({ freq, duration: 0.14, type: "sine", gain: 0.2 });
  },
};
