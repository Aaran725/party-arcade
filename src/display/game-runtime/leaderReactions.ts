const DEFAULT_COOLDOWN_MS = 12_000;

/**
 * A per-DisplayModule throttle so the AI Game Leader comments on a genuine big moment,
 * not every hit — the same cooldown-timestamp shape already used throughout this
 * codebase for other per-player/per-game throttles (e.g. Paint Wars' claim-sound
 * cooldown), generalized into one shared primitive now that six games need the
 * identical pattern for mid-round commentary.
 */
export class ReactionGate {
  private lastFiredAt = 0;

  constructor(private cooldownMs = DEFAULT_COOLDOWN_MS) {}

  /** Calls hostSpeak(line) if the cooldown has elapsed since the last fire; silently skips otherwise. hostSpeak itself is already a no-op when the Leader isn't on, so this never needs its own enabled-check. */
  fire(hostSpeak: (text: string) => void, line: string): void {
    const now = performance.now();
    if (now - this.lastFiredAt < this.cooldownMs) return;
    this.lastFiredAt = now;
    hostSpeak(line);
  }
}
