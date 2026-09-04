export interface ShakeState {
  magnitude: number;
  until: number;
}

export function createShakeState(): ShakeState {
  return { magnitude: 0, until: 0 };
}

export function triggerShake(state: ShakeState, magnitude: number, durationMs: number): void {
  state.magnitude = Math.max(state.magnitude, magnitude);
  state.until = Math.max(state.until, performance.now() + durationMs);
}

/** Wraps a draw call in a jittered, decaying translate — one-line drop-in. */
export function withShake<T>(ctx: CanvasRenderingContext2D, state: ShakeState, now: number, draw: () => T): T {
  const remaining = state.until - now;
  if (remaining <= 0) return draw();
  const decay = remaining / 260; // assumes ~260ms typical shake duration for falloff feel
  const amount = state.magnitude * Math.min(1, decay);
  ctx.save();
  ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
  const result = draw();
  ctx.restore();
  return result;
}
