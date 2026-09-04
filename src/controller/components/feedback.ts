import { el } from "@shared/dom";

const RIPPLE_MS = 380;

/**
 * A visible per-tap ripple at the exact touch point — the shared `:active` CSS scale on
 * buttons is easy to miss during rapid repeated tapping (push-battle's mash, laser-blaster's
 * tap zone), since a fast pointerdown/pointerup cycle can outrun the transition. This is a
 * fire-and-forget DOM element, self-removing, independent of any button's own state.
 */
export function spawnTouchRipple(x: number, y: number): void {
  const ripple = el("div", { class: "touch-ripple", style: `left:${x}px;top:${y}px` });
  document.body.append(ripple);
  setTimeout(() => ripple.remove(), RIPPLE_MS);
}

/** A brief confirming pulse for the moment a silent auto-calibration actually lands — the recurring "did that work?" gap across every motion/pointer game and the calibration screens. */
export function flashCalibrateConfirm(target: HTMLElement): void {
  target.classList.remove("anim-calibrate-confirm");
  void target.offsetWidth;
  target.classList.add("anim-calibrate-confirm");
}
