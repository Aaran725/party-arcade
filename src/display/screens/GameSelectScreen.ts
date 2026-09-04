import { el } from "@shared/dom";
import type { GameMeta, PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";
import { mountAmbientBackground, MENU_THEME } from "../game-runtime/ambientMenuBackground";
import { THEMES, type GameTheme } from "../game-runtime/theme";

export const ICONS: Record<string, string> = {
  "reaction-buzzer": "🔔",
  "tilt-maze": "🌀",
  "laser-blaster": "🎯",
  "fruit-slice": "🍉",
  "simon-says": "🧠",
  "paint-wars": "🎨",
  "trivia-buzzer": "❓",
  "sleeper-agent": "🕵️",
  "doodle-relay": "✏️",
  "draw-off": "🖼️",
  "scream-royale": "🎤",
  "snap-judgment": "📸",
  "echo-chain": "🗣️",
  "plot-twist": "🌀",
  "push-battle": "🤜",
  "ai-wildcard": "🎲",
  "hot-potato": "🥔",
};

export function renderGameSelectScreen(
  root: HTMLElement,
  opts: { games: GameMeta[]; players: PlayerInfo[]; onSelect: (gameId: GameMeta["id"]) => void; onStartParty: () => void },
): void {
  const playerCount = opts.players.length;
  // Assigned after root.replaceChildren() below (mountAmbientBackground prepends into root,
  // and replaceChildren would otherwise wipe it out) — card hover handlers close over this
  // binding, not its value, so they still see the real instance once it's set.
  let ambient: { setTheme: (theme: GameTheme) => void } | null = null;

  const cards = opts.games.map((g) => {
    const playable = playerCount >= g.minPlayers && playerCount <= g.maxPlayers;
    const card = el("div", { class: `glass-card game-card anim-pop-in${playable ? "" : " disabled"}` }, [
      el("span", { class: "icon" }, [ICONS[g.id] ?? "🎮"]),
      el("h3", { class: "title-md" }, [g.title]),
      el("p", { class: "text-body" }, [g.description]),
      el("p", { class: "text-caption" }, [`${g.minPlayers}-${g.maxPlayers} players`]),
    ]);
    card.addEventListener("click", () => playable && opts.onSelect(g.id));
    // Previewing a game's real theme on hover is the first place in the app where picking a
    // game visually telegraphs its identity before it actually starts.
    card.addEventListener("mouseenter", () => ambient?.setTheme(THEMES[g.id]));
    card.addEventListener("mouseleave", () => ambient?.setTheme(MENU_THEME));
    return card;
  });

  const partyBtn = el("button", { class: "glass-button accent" }, ["🎉 Start a Party"]);
  partyBtn.disabled = playerCount === 0;
  partyBtn.addEventListener("click", opts.onStartParty);

  root.replaceChildren(
    // width:100% — an unstyled wrapper shrink-to-fits inside #app's centered flex; with
    // few/sparse cards that can collapse the grid below its own minmax() track minimum.
    el("div", { style: "width:100%" }, [
      el("div", { class: "screen-header" }, [
        el("h2", { class: "title-lg" }, ["Play"]),
        el("p", { class: "text-body" }, [`${playerCount} player${playerCount === 1 ? "" : "s"} connected`]),
        partyBtn,
      ]),
      el("p", { class: "text-caption" }, ["Quick play — jump into one game"]),
      el("div", { class: "game-select-grid" }, cards),
    ]),
  );
  ambient = mountAmbientBackground(root);
}

export function renderCalibrationWaitScreen(
  root: HTMLElement,
  opts: { meta: GameMeta; players: PlayerInfo[]; readyIds: Set<string>; onStart: () => void },
): void {
  const rows = opts.players.map((p) =>
    el("div", { class: "glass-pill calibrate-row" }, [
      createAvatarSvg(p.id, p.color),
      p.name,
      el("span", { class: "text-caption" }, [opts.readyIds.has(p.id) ? "Ready ✓" : "Calibrating…"]),
    ]),
  );

  const startBtn = el("button", { class: "glass-button accent" }, ["Start game"]);
  startBtn.addEventListener("click", opts.onStart);

  root.replaceChildren(
    el("div", { class: "screen-header" }, []),
    el("div", { class: "glass-panel lobby-panel anim-pop-in" }, [
      el("p", { class: "text-caption" }, [`Get ready — ${opts.meta.title}`]),
      el("p", { class: "text-body" }, [opts.meta.description]),
      el("div", { class: "calibrate-list" }, rows),
      startBtn,
    ]),
  );
}
