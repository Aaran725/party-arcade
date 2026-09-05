// Lets the Controller install as a real home-screen app (icon, standalone launch, no
// browser chrome) via public/sw.js's static-shell-only cache. Feature-detected and
// silently no-op everywhere else, same resilience contract as wakeLock.ts/motion/camera —
// never force-prompts, never blocks anything if it fails.
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a nice-to-have, not a requirement — a failed registration
      // (e.g. served over plain HTTP on some LAN setups) must never block the app itself.
    });
  });
}
