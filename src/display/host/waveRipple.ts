import { el } from "@shared/dom";
import type { PlayerInfo } from "@shared/types/room";

// Mirrors server/protocol/handlers.ts's WAVE_STAGGER_MS — keeps this local TV ripple in
// lockstep with the phones' own staggered flash/vibrate/tone, even though this runs purely
// client-side with no round-trip (the Display already knows its own player list and the
// fixed per-step stagger, so there's nothing to wait on the server for).
const STAGGER_MS = 220;
const RIPPLE_MS = 900;

/** The TV-side half of the synchronized phone wave — previously triggering a wave only lit up phones, leaving the screen itself blank. This drops one falling dot per player, in their own avatar color and the same stagger order/timing the phones use, so the room reads as one connected light show instead of two disconnected systems. */
export function playWaveRipple(players: PlayerInfo[]): void {
  if (players.length === 0) return;
  const overlay = el("div", { class: "wave-ripple-overlay" });
  players.forEach((p, i) => {
    const dot = el("div", { class: "wave-ripple-dot" });
    dot.style.setProperty("--wave-color", p.color);
    dot.style.setProperty("--wave-x", `${((i + 0.5) / players.length) * 100}%`);
    dot.style.animationDelay = `${i * STAGGER_MS}ms`;
    overlay.append(dot);
  });
  document.body.append(overlay);
  setTimeout(() => overlay.remove(), players.length * STAGGER_MS + RIPPLE_MS);
}
