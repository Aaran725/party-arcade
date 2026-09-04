import { prefersReducedMotion } from "@shared/dom";
import { onOrientation } from "./input/motion";

// Degrees of tilt that sweep the highlight from edge to edge of its travel range —
// deliberately gentle, this is ambient light response, not a control input.
const TILT_RANGE_DEG = 35;

/**
 * Wires tokens.css's --light-x/--light-y to live device tilt, letting .glass-panel's
 * highlight (glass.css) visibly respond to how the phone is being held — Phase 15's
 * onOrientation() sensor plumbing, reused for something purely cosmetic this time.
 *
 * Safe to call unconditionally at boot: `deviceorientation` listeners registered before
 * iOS's explicit motion-permission grant simply receive nothing until/unless permission
 * is later granted by some motion-requiring game — no re-subscribe needed, the same
 * listener starts receiving real events the moment that happens. Until then (or on a
 * session that never plays a motion game), the CSS default in tokens.css just keeps the
 * original static top-lit look. Never force-prompts for permission itself.
 */
export function startLiquidGlassTilt(): () => void {
  if (prefersReducedMotion()) return () => {};
  return onOrientation((beta, gamma) => {
    const x = 50 + Math.max(-1, Math.min(1, gamma / TILT_RANGE_DEG)) * 50;
    const y = 20 + Math.max(-1, Math.min(1, beta / TILT_RANGE_DEG)) * 20;
    document.documentElement.style.setProperty("--light-x", `${x}%`);
    document.documentElement.style.setProperty("--light-y", `${y}%`);
  });
}
