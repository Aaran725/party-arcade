import { el } from "@shared/dom";
import type { HallOfFameEntrySnapshot } from "@shared/protocol/messages";

/**
 * A real, TV-visible shared scoreboard — the first place any device's stats
 * (server/storage/playerStore.ts, tracked since Career profiles shipped) are visible to
 * anyone other than that one device. Reuses the same .glass-pill/.scoreboard-row chrome
 * GameOverScreen.ts's scoreboard() already established, just without avatars — Hall of
 * Fame entries are historical records keyed by name, not live PlayerInfo objects.
 */
export function renderHallOfFameScreen(root: HTMLElement, opts: { entries: HallOfFameEntrySnapshot[]; onBack: () => void }): void {
  const backBtn = el("button", { class: "glass-button" }, ["← Back"]);
  backBtn.addEventListener("click", opts.onBack);

  const rows = opts.entries.map((entry, i) =>
    el("div", { class: "glass-pill scoreboard-row anim-pop-in" }, [
      el("span", { class: "rank" }, [`${i + 1}`]),
      el("span", { style: "flex:1" }, [entry.name]),
      el("span", { class: "text-caption" }, [`${entry.gamesPlayed} played`]),
      el("span", { class: "text-caption" }, [`${entry.achievementCount} 🎖️`]),
      el("span", { class: "mono" }, [`${entry.wins} wins`]),
    ]),
  );

  root.replaceChildren(
    el("div", { style: "width:100%" }, [
      el("div", { class: "screen-header" }, [
        el("h2", { class: "title-lg" }, ["🏆 Hall of Fame"]),
        el("p", { class: "text-body" }, ["Every player who's ever taken the stage on this server."]),
        backBtn,
      ]),
      el("div", { class: "scoreboard" }, rows.length ? rows : [el("p", { class: "text-body" }, ["Nobody's finished a game here yet — be the first."])]),
    ]),
  );
}
