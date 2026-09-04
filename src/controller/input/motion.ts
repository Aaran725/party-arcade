import { SWIPE_ACCEL_THRESHOLD, SWIPE_DEBOUNCE_MS } from "@shared/protocol/constants";

type PermissionState = "unknown" | "granted" | "denied";

let cachedState: PermissionState = "unknown";

interface RequestableEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export function motionNeedsExplicitPermission(): boolean {
  const DME = window.DeviceMotionEvent as unknown as RequestableEvent;
  const DOE = window.DeviceOrientationEvent as unknown as RequestableEvent;
  return typeof DME?.requestPermission === "function" || typeof DOE?.requestPermission === "function";
}

/** Must be called from inside a user-gesture handler (e.g. a button tap) on iOS 13+. */
export async function requestMotionPermission(): Promise<boolean> {
  if (cachedState === "granted") return true;

  try {
    const DME = window.DeviceMotionEvent as unknown as RequestableEvent;
    const DOE = window.DeviceOrientationEvent as unknown as RequestableEvent;

    let granted = true;
    if (typeof DME?.requestPermission === "function") {
      granted = (await DME.requestPermission()) === "granted" && granted;
    }
    if (typeof DOE?.requestPermission === "function") {
      granted = (await DOE.requestPermission()) === "granted" && granted;
    }
    cachedState = granted ? "granted" : "denied";
    return granted;
  } catch {
    cachedState = "denied";
    return false;
  }
}

interface CompassOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

/**
 * Degrees clockwise from north, 0..360 — a sensor axis this app has never read (every
 * existing motion game only uses beta/gamma tilt). iOS Safari exposes true compass
 * heading directly via the non-standard `webkitCompassHeading` on the same
 * `deviceorientation` event already used for tilt; standards-based browsers (Android
 * Chrome) only have `alpha` (rotation around the vertical axis, not true north), which
 * this approximates as compass heading via `(360 - alpha) % 360`. Real-world accuracy
 * varies by device/case material either way — treated as "close enough for a party game,"
 * not a precision instrument.
 */
export function onCompassHeading(cb: (headingDeg: number) => void): () => void {
  const handler = (ev: DeviceOrientationEvent) => {
    const withWebkit = ev as CompassOrientationEvent;
    if (typeof withWebkit.webkitCompassHeading === "number") {
      cb(withWebkit.webkitCompassHeading);
    } else if (ev.alpha != null) {
      cb((360 - ev.alpha) % 360);
    }
  };
  window.addEventListener("deviceorientation", handler);
  return () => window.removeEventListener("deviceorientation", handler);
}

export function onOrientation(cb: (beta: number, gamma: number) => void): () => void {
  const handler = (ev: DeviceOrientationEvent) => {
    if (ev.beta == null || ev.gamma == null) return;
    cb(ev.beta, ev.gamma);
  };
  window.addEventListener("deviceorientation", handler);
  return () => window.removeEventListener("deviceorientation", handler);
}

export function onMotion(cb: (ax: number, ay: number, az: number, ts: number) => void): () => void {
  const handler = (ev: DeviceMotionEvent) => {
    const a = ev.acceleration;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    cb(a.x, a.y, a.z, ev.timeStamp);
  };
  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}

/**
 * A real "shake the phone" gesture — the first thing in this app to read raw
 * accelerometer magnitude for anything beyond passive tilt. Fires `onIntensity` on every
 * sample (0..1, for a live shake meter) and `onShake` (debounced) whenever magnitude
 * crosses SWIPE_ACCEL_THRESHOLD — reusing the existing swipe-detection constants rather
 * than inventing shake-specific ones, since a hard shake and a hard swipe are the same
 * underlying signal (a sudden acceleration spike).
 */
export function onShake(opts: {
  onShake: () => void;
  onIntensity?: (level: number) => void;
  threshold?: number;
  debounceMs?: number;
}): () => void {
  const threshold = opts.threshold ?? SWIPE_ACCEL_THRESHOLD;
  const debounceMs = opts.debounceMs ?? SWIPE_DEBOUNCE_MS;
  let lastShakeAt = 0;

  return onMotion((ax, ay, az) => {
    const magnitude = Math.hypot(ax, ay, az);
    opts.onIntensity?.(Math.max(0, Math.min(1, magnitude / threshold)));
    if (magnitude < threshold) return;
    const now = performance.now();
    if (now - lastShakeAt < debounceMs) return;
    lastShakeAt = now;
    opts.onShake();
  });
}
