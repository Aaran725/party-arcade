import { unlockAudio } from "@shared/audio";
import { sfx } from "../sfx";

/** The actual `navigator.vibrate` call, with no sound attached — factored out so a caller with its own distinct sound (the phone wave's sfx.wave(), rather than the generic tap/submit/success set) doesn't end up with two tones firing at once. Everything else should call vibrate() below, not this. */
function rawVibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // ignore — not all browsers support this
    }
  }
}

export function vibrate(pattern: number | number[]): void {
  // Every vibrate() call already happens synchronously inside a real tap/touch handler —
  // the same user-gesture guarantee the Display's own unlockAudio() callers rely on — so
  // this is a safe place to both unlock audio on first use and play a matching sound.
  unlockAudio();
  if (Array.isArray(pattern)) sfx.success();
  else if (pattern <= 12) sfx.tap();
  else sfx.submit();

  rawVibrate(pattern);
}

/** For a caller that plays its own distinct sound instead of vibrate()'s generic tap/submit/success — still unlocks audio the same way, just doesn't pair a sound here. */
export function vibrateSilent(pattern: number | number[]): void {
  unlockAudio();
  rawVibrate(pattern);
}
