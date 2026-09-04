// A phone sitting idle on a waiting-room or spectator screen for a minute auto-locks —
// the player then has to unlock and (in the worst case) rejoin mid-party. The Screen
// Wake Lock API fixes this directly; Safari has supported it since 16.4. Feature-detected
// and silently no-op everywhere else, same resilience contract as every other browser API
// this app touches (motion permission, camera, mic, share).
interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: "release", cb: () => void) => void;
}

let sentinel: WakeLockSentinelLike | null = null;

function wakeLockSupported(): boolean {
  return "wakeLock" in navigator;
}

export async function requestWakeLock(): Promise<void> {
  if (!wakeLockSupported() || sentinel) return;
  try {
    // `wakeLock` isn't in this project's lib.dom yet — narrow through unknown rather than `any`.
    const nav = navigator as unknown as { wakeLock: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
    sentinel = await nav.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    sentinel = null; // e.g. released because the tab backgrounded before the request settled — harmless
  }
}

export function releaseWakeLock(): void {
  void sentinel?.release();
  sentinel = null;
}

/** Wake locks are automatically released when a tab backgrounds — call this from a visibilitychange handler to re-acquire once it's foreground again. */
export function reacquireWakeLockOnVisible(): () => void {
  const handler = () => {
    if (document.visibilityState === "visible") void requestWakeLock();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
