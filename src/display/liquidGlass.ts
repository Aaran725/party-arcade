import { prefersReducedMotion } from "@shared/dom";

/**
 * The Display-side counterpart to controller/liquidGlass.ts's tilt-reactive highlight —
 * the TV has no orientation to read, but the host does interact with HostControls/menus
 * via a pointer (mouse, trackpad, or a remote emulating one), so tokens.css's
 * --light-x/--light-y track that instead. No-op under prefers-reduced-motion, same as
 * every other ambient effect in this app.
 */
export function startLiquidGlassPointer(): () => void {
  if (prefersReducedMotion()) return () => {};
  const handler = (e: MouseEvent) => {
    const x = (e.clientX / window.innerWidth) * 100;
    const y = (e.clientY / window.innerHeight) * 100;
    document.documentElement.style.setProperty("--light-x", `${x}%`);
    document.documentElement.style.setProperty("--light-y", `${y}%`);
  };
  window.addEventListener("mousemove", handler, { passive: true });
  return () => window.removeEventListener("mousemove", handler);
}
