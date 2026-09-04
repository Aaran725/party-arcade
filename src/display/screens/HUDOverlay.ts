import { el } from "@shared/dom";
import type { PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";

export class HUDOverlay {
  private root: HTMLElement;
  private pills = new Map<string, HTMLElement>();
  private lastScores = new Map<string, number>();

  constructor(container: HTMLElement, players: PlayerInfo[]) {
    // Split left/right instead of one full-width space-between row — nearly every game
    // independently draws its own centered "Round X / Y" text at the top of the canvas,
    // and a single spread row will eventually land a pill right on top of it for some
    // player count. Keeping the true top-center clear works for any number of players.
    this.root = el("div", { class: "hud-overlay" });
    const left = el("div", { class: "hud-overlay-group" });
    const right = el("div", { class: "hud-overlay-group" });
    const mid = Math.ceil(players.length / 2);

    players.forEach((p, i) => {
      const pill = el("div", { class: "glass-pill mono", style: "position:relative" }, [
        createAvatarSvg(p.id, p.color),
        `${p.name}: 0`,
      ]);
      this.pills.set(p.id, pill);
      this.lastScores.set(p.id, 0);
      (i < mid ? left : right).append(pill);
    });

    this.root.append(left, right);
    container.append(this.root);
  }

  setScore(playerId: string, name: string, score: number): void {
    const pill = this.pills.get(playerId);
    if (!pill) return;
    const label = pill.lastChild;
    if (label) label.textContent = `${name}: ${score}`;

    const prev = this.lastScores.get(playerId) ?? score;
    this.lastScores.set(playerId, score);
    const delta = score - prev;
    if (delta === 0) return;

    pill.classList.remove("anim-score-pulse");
    void pill.offsetWidth; // restart the animation even if it's already mid-pulse from a rapid double score
    pill.classList.add("anim-score-pulse");

    const badge = el("span", { class: "score-delta-badge" }, [`${delta > 0 ? "+" : ""}${delta}`]);
    pill.append(badge);
    setTimeout(() => badge.remove(), 1200);
  }

  destroy(): void {
    this.root.remove();
  }
}
