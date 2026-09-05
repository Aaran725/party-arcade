/**
 * The shared round/phase state machine every timed game runs on.
 *
 * Nine games used to hand-roll this: a `phase` field, a `phaseDeadline` field, and an
 * interchangeable `switch (this.phase) { case X: if (now >= this.phaseDeadline) … }` block
 * in `tick()`. That duplication wasn't just verbose — it had no concept of a *terminal*
 * phase, and four games fell straight through the gap: their `finishGame()` neither
 * changed `phase` nor pushed `phaseDeadline`, so the expired phase re-fired it every frame
 * for the ~900ms before game-over — dozens of stacked confetti bursts and overlapping
 * fanfares. `finish()` below is idempotent precisely so that can't happen again.
 *
 * Deliberately DOM-free (no canvas, no Web Audio, no document) so it can be unit-tested
 * under plain node — jsdom has no canvas 2D context, so anything drawing-adjacent would be
 * untestable. Sound is injected via `onCountdownTick` rather than imported.
 */

export interface PhaseSpec {
  /** Runs once, immediately, when the phase is entered via setPhase(). */
  onEnter?: () => void;
  /** Runs every frame the phase is active, before any expiry is considered. */
  onFrame?: (now: number, remaining: number, dt: number) => void;
  /** Runs once when the deadline passes. Free to branch on game state, or to transition. */
  onExpire?: () => void;
  /**
   * Opt-in: when this returns true, the phase stops waiting out its full timer and instead
   * resolves after a short lock-in beat. Only worth it where "everyone has answered" is
   * both knowable and final — not on phases where players legitimately revise (retaking a
   * photo, rewriting an answer), and not where the timer itself is the mechanic.
   */
  endEarlyWhen?: () => boolean;
  /** Play a once-per-second tick over the last few seconds (the engine owns the timing bookkeeping). */
  countdownTicks?: boolean;
}

export interface PhaseMachineOptions {
  /** Injected rather than imported, to keep this module free of Web Audio. */
  onCountdownTick?: () => void;
}

const COUNTDOWN_WINDOW_MS = 3000;
const COUNTDOWN_INTERVAL_MS = 1000;
/** Long enough to read "locking in…" and change your mind, short enough not to feel like the old dead wait. */
export const LOCK_IN_MS = 2500;

export class PhaseMachine<P extends string> {
  private current: P;
  private deadline = Infinity;
  private halted = false;
  private lastCountdownTickAt = 0;
  private lockingIn = false;
  private finishAt: number | null = null;
  private onFinish: (() => void) | null = null;

  constructor(
    initial: P,
    private readonly specs: Partial<Record<P, PhaseSpec>>,
    private readonly options: PhaseMachineOptions = {},
  ) {
    this.current = initial;
  }

  get phase(): P {
    return this.current;
  }

  /** True once the game has finished — no further phase handlers will run. */
  get isHalted(): boolean {
    return this.halted;
  }

  /** True during the brief beat after everyone answered but before the phase resolves; games can use it to show a "locking in" hint. */
  get isLockingIn(): boolean {
    return this.lockingIn;
  }

  remaining(now: number): number {
    return this.deadline === Infinity ? Infinity : Math.max(0, this.deadline - now);
  }

  /** Enter `next`, running its onEnter. Omit `durationMs` for a phase that only ends when the game says so. */
  setPhase(next: P, durationMs = Infinity, now = performance.now()): void {
    if (this.halted) return;
    this.current = next;
    this.deadline = durationMs === Infinity ? Infinity : now + durationMs;
    this.lockingIn = false;
    this.lastCountdownTickAt = 0;
    this.specs[next]?.onEnter?.();
  }

  /** Extend (or shorten) the current phase without re-entering it — no onEnter, no lock-in reset. */
  setDeadline(durationMs: number, now = performance.now()): void {
    this.deadline = durationMs === Infinity ? Infinity : now + durationMs;
  }

  /**
   * End the game: stop all phase dispatch, then fire `onDone` once after `delayMs` (time for
   * a confetti burst to actually play). Idempotent — repeat calls are ignored, which is the
   * guard the four buggy games lacked. Driven by tick() rather than setTimeout so it dies
   * with the game loop instead of leaving an orphaned timer behind.
   */
  finish(delayMs: number, onDone: () => void, now = performance.now()): void {
    if (this.halted) return;
    this.halted = true;
    this.finishAt = now + delayMs;
    this.onFinish = onDone;
  }

  /** Drive one frame. Dispatches at most one expiry, and never runs a stale phase's handler after a transition. */
  tick(now: number, dt: number): void {
    if (this.halted) {
      if (this.finishAt !== null && now >= this.finishAt) {
        const done = this.onFinish;
        this.finishAt = null;
        this.onFinish = null;
        done?.();
      }
      return;
    }

    const spec = this.specs[this.current];
    if (!spec) return;
    // Snapshotted so a handler that transitions mid-frame can't have the *old* phase's
    // remaining work applied to the new one. Transitions fire from input handlers, async AI
    // results and player-leave events as well as from here, so this is a real case.
    const entered = this.current;

    if (!this.lockingIn && spec.endEarlyWhen?.()) {
      this.lockingIn = true;
      const early = now + LOCK_IN_MS;
      if (early < this.deadline) this.deadline = early;
    }

    const remaining = this.remaining(now);

    if (spec.countdownTicks && remaining <= COUNTDOWN_WINDOW_MS && now - this.lastCountdownTickAt >= COUNTDOWN_INTERVAL_MS) {
      this.lastCountdownTickAt = now;
      this.options.onCountdownTick?.();
    }

    spec.onFrame?.(now, remaining, dt);
    if (this.current !== entered || this.halted) return;

    if (remaining <= 0) spec.onExpire?.();
  }
}
