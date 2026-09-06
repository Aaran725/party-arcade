import { el } from "@shared/dom";
import { createAvatarSvg } from "@shared/avatar";
import { ACHIEVEMENTS } from "@shared/achievements";
import { levelForXp, xpForNextLevel } from "@shared/progression";
import type { GameId } from "@shared/types/room";
import { vibrate } from "../input/haptics";

export interface CareerData {
  gamesPlayed: number;
  wins: number;
  playCounts: Partial<Record<GameId, number>>;
  winsByGame: Partial<Record<GameId, number>>;
  achievements: string[];
  favoriteGameTitle: string | null;
  xp: number;
  currentStreak: number;
  longestStreak: number;
}

export function renderCareerScreen(
  root: HTMLElement,
  opts: { id: string; name: string; color: string; data: CareerData; onBack: () => void },
): void {
  const { data } = opts;
  const winRate = data.gamesPlayed > 0 ? Math.round((data.wins / data.gamesPlayed) * 100) : 0;

  const backBtn = el("button", { class: "glass-button" }, ["← Back"]);
  backBtn.addEventListener("click", opts.onBack);

  const shareBtn = el("button", { class: "glass-button accent" }, ["Share my stats"]);
  shareBtn.addEventListener("click", () => {
    vibrate(15);
    const text = `🏆 ${data.gamesPlayed} games played, ${data.wins} wins (${winRate}% win rate) on Party Arcade!`;
    if (navigator.share) {
      navigator.share({ title: "Party Arcade", text }).catch(() => {}); // user-cancelled or unsupported mid-call — not an error worth surfacing
    } else if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        shareBtn.textContent = "Copied!";
        setTimeout(() => (shareBtn.textContent = "Share my stats"), 1800);
      });
    }
  });

  const stat = (value: string, label: string) =>
    el("div", { style: "display:flex;flex-direction:column;align-items:center;gap:0.1em" }, [
      el("span", { class: "title-lg mono" }, [value]),
      el("span", { class: "text-caption" }, [label]),
    ]);

  const level = levelForXp(data.xp);
  const { current, needed } = xpForNextLevel(data.xp);
  const xpBar = el("div", { style: "display:flex;flex-direction:column;align-items:center;gap:0.4em;width:100%" }, [
    el("div", { class: "glass-pill" }, [`⭐ Level ${level}`]),
    el("div", { class: "xp-bar-track" }, [el("div", { class: "xp-bar-fill", style: `width:${(current / needed) * 100}%` })]),
    el("span", { class: "text-caption" }, [`${current} / ${needed} XP to next level`]),
  ]);

  const cards = ACHIEVEMENTS.map((a) => {
    const unlocked = data.achievements.includes(a.id);
    return el("div", { class: `achievement-card${unlocked ? " unlocked" : ""}` }, [
      el("div", { class: "achievement-icon" }, [a.emoji]),
      el("span", { class: "text-body" }, [a.title]),
      el("span", { class: "text-caption" }, [a.description]),
    ]);
  });

  root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1.2em" }, [
      createAvatarSvg(opts.id, opts.color, { size: "3.4em" }),
      el("h2", { class: "title-md" }, [`${opts.name}'s Career`]),
      xpBar,
      el("div", { style: "display:flex;gap:1.6em;justify-content:center;flex-wrap:wrap" }, [
        stat(`${data.gamesPlayed}`, "Played"),
        stat(`${data.wins}`, "Wins"),
        stat(`${winRate}%`, "Win rate"),
        // A permanent "Streak: 0" reads as a failure state, not a stat worth showing —
        // only surfaced while there's actually something live to show off.
        ...(data.currentStreak > 0 ? [stat(`${data.currentStreak}🔥`, "Win streak")] : []),
      ]),
      ...(data.favoriteGameTitle ? [el("p", { class: "text-caption" }, [`Most played: ${data.favoriteGameTitle}`])] : []),
      el("div", { class: "achievement-grid" }, cards),
      shareBtn,
      backBtn,
    ]),
  );
}
