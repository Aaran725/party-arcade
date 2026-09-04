import { el } from "@shared/dom";
import type { PointerCalibration } from "./pointer-calibration";

/**
 * Renders the live pointer position locally on the phone screen — `.reticle-dot`
 * (controller.css) already existed for exactly this and was never wired up, leaving
 * laser-blaster/fruit-slice/paint-wars' phone screen completely static during play while
 * all the actual visual feedback happened on the TV. Subscribes to the same
 * `PointerCalibration.onUpdate()` each of those games already calls to drive `sendInput`.
 */
export function mountReticle(calibration: PointerCalibration): () => void {
  const dot = el("div", { class: "reticle-dot" });
  document.body.append(dot);
  const unsubscribe = calibration.onUpdate((x, y) => {
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${y * 100}%`;
  });
  return () => {
    unsubscribe();
    dot.remove();
  };
}
