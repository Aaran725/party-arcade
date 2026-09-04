import { el } from "@shared/dom";

const FLASH_MS = 500;

/** The visible half of the synchronized phone wave — a brief full-screen glow in the player's own avatar color, paired with a vibrate + sfx.wave() tone by the caller so the ripple is felt, heard, and seen. */
export function flashWave(color: string): void {
  const overlay = el("div", { class: "wave-flash" });
  overlay.style.setProperty("--wave-color", color);
  document.body.append(overlay);
  setTimeout(() => overlay.remove(), FLASH_MS);
}
