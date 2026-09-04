// Every touch interaction in this app up to now is single-pointer (tap, drag, tilt-driven
// pointer). This is the first real multi-touch gesture — two fingers spreading apart,
// detected from raw `TouchList` distance, independent of PointerCalibration's Wii-remote
// pointer pathway.
const SPREAD_THRESHOLD_PX = 60;
const DEBOUNCE_MS = 800;

function distance(touches: TouchList): number {
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Fires `onSpread` (debounced) when two fingers on `target` move apart past a threshold — a discrete "pinch out" gesture, not a continuous pinch-to-zoom value. */
export function onPinchSpread(target: HTMLElement, onSpread: () => void): () => void {
  let startDistance: number | null = null;
  let lastFireAt = 0;

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) startDistance = distance(e.touches);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2 || startDistance === null) return;
    const current = distance(e.touches);
    if (current - startDistance <= SPREAD_THRESHOLD_PX) return;
    const now = performance.now();
    startDistance = current; // reset the baseline so a sustained spread doesn't keep re-crossing the threshold every move tick
    if (now - lastFireAt < DEBOUNCE_MS) return;
    lastFireAt = now;
    onSpread();
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) startDistance = null;
  };

  target.addEventListener("touchstart", onTouchStart, { passive: true });
  target.addEventListener("touchmove", onTouchMove, { passive: true });
  target.addEventListener("touchend", onTouchEnd, { passive: true });
  target.addEventListener("touchcancel", onTouchEnd, { passive: true });

  return () => {
    target.removeEventListener("touchstart", onTouchStart);
    target.removeEventListener("touchmove", onTouchMove);
    target.removeEventListener("touchend", onTouchEnd);
    target.removeEventListener("touchcancel", onTouchEnd);
  };
}
