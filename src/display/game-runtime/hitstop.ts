export interface HitStopState {
  freezeUntil: number;
}

export function createHitStopState(): HitStopState {
  return { freezeUntil: 0 };
}

export function triggerHitStop(state: HitStopState, now: number, ms: number): void {
  state.freezeUntil = Math.max(state.freezeUntil, now + ms);
}

/** Returns 0 while frozen (for physics-only updates) — draw() should still run every frame regardless. */
export function effectiveDt(state: HitStopState, now: number, dt: number): number {
  return now < state.freezeUntil ? 0 : dt;
}
