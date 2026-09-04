import { POINTER_SENSITIVITY_DEG } from "@shared/protocol/constants";
import { onOrientation } from "./motion";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Wii-remote-style pointer: tap "calibrate" to zero a baseline orientation,
 * then subsequent tilt deltas map to a normalized (0..1) screen-space cursor.
 */
export class PointerCalibration {
  private baseline: { beta: number; gamma: number } | null = null;
  private latest = { beta: 0, gamma: 0 };
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<(x: number, y: number) => void>();

  start(): void {
    this.unsubscribe = onOrientation((beta, gamma) => {
      this.latest = { beta, gamma };
      if (this.baseline) this.emit();
    });
  }

  calibrate(): void {
    this.baseline = { ...this.latest };
  }

  recalibrate(): void {
    this.calibrate();
  }

  private emit(): void {
    const { x, y } = this.getPointer();
    this.listeners.forEach((cb) => cb(x, y));
  }

  getPointer(): { x: number; y: number } {
    if (!this.baseline) return { x: 0.5, y: 0.5 };
    const deltaGamma = this.latest.gamma - this.baseline.gamma;
    const deltaBeta = this.latest.beta - this.baseline.beta;
    // Negated: tilting the phone right/down should move the reticle right/down on
    // screen, which is the opposite of the raw sensor delta direction in practice.
    const x = clamp(0.5 - deltaGamma / (POINTER_SENSITIVITY_DEG * 2), 0, 1);
    const y = clamp(0.5 - deltaBeta / (POINTER_SENSITIVITY_DEG * 2), 0, 1);
    return { x, y };
  }

  onUpdate(cb: (x: number, y: number) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.listeners.clear();
  }
}
