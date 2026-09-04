import { prefersReducedMotion } from "@shared/dom";
import { createStageCanvas } from "./canvas";
import { drawAmbientBackground, type GameTheme } from "./theme";

/** A neutral idle theme for menu/lobby screens — tuned to the existing --bg-0/--bg-1 palette so it reads as an extension of the flat gradient those screens already sit on, not a departure from it. */
export const MENU_THEME: GameTheme = { bg0: "#0b0b12", bg1: "#1c1c30", accent: "#0a84ff", motif: "pulseRings" };

/**
 * Mounts a full-bleed ambient canvas as `host`'s first child (a fixed, negative-z layer —
 * sits above the page's plain background but below every normal-flow screen element,
 * without needing to touch any of those elements' own stacking). Starts a self-terminating
 * animation loop: once `host.replaceChildren(...)` (the next screen swap) removes this
 * canvas from the DOM, the loop notices and tears itself down — same pattern
 * PartyFinaleScreen already uses for its confetti canvas, just generalized to run
 * indefinitely instead of for a fixed duration.
 *
 * Returns a `setTheme` setter so a screen can blend the motif/accent toward something
 * contextual (e.g. a hovered game card's real theme) without remounting the canvas.
 */
export function mountAmbientBackground(host: HTMLElement, initial: GameTheme = MENU_THEME): { setTheme: (theme: GameTheme) => void } {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none";
  host.prepend(wrap);

  const { canvas, ctx, dispose } = createStageCanvas(wrap);
  let theme = initial;

  function drawOnce(now: number): void {
    const dpr = window.devicePixelRatio || 1;
    drawAmbientBackground(ctx, canvas.width / dpr, canvas.height / dpr, theme, now);
  }

  if (prefersReducedMotion()) {
    // Still shows the themed background (including the hover preview via setTheme below) —
    // just as a static frame instead of a running animation loop.
    drawOnce(0);
  } else {
    const frame = (now: number): void => {
      if (!wrap.isConnected) {
        dispose();
        return;
      }
      drawOnce(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  return {
    setTheme: (next) => {
      theme = next;
      if (prefersReducedMotion()) drawOnce(0);
    },
  };
}
