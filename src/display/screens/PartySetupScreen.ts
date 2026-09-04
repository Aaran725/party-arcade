import { el } from "@shared/dom";
import type { GameId, GameMeta, PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";
import { ICONS } from "./GameSelectScreen";
import { mountAmbientBackground } from "../game-runtime/ambientMenuBackground";

export type TeamId = "A" | "B";
export type TeamAssignments = Record<string, TeamId>;

const TEAM_LABELS: Record<TeamId, string> = { A: "Team A", B: "Team B" };

export function renderPartySetupScreen(
  root: HTMLElement,
  opts: {
    games: GameMeta[];
    players: PlayerInfo[];
    onStart: (gameIds: GameId[], teams: TeamAssignments | null) => void;
    onCancel: () => void;
  },
): void {
  const selected = new Set<GameId>(opts.games.map((g) => g.id));
  let teamModeEnabled = false;
  const teams: TeamAssignments = {};
  opts.players.forEach((p, i) => (teams[p.id] = i % 2 === 0 ? "A" : "B")); // even split by default

  const startBtn = el("button", { class: "glass-button accent" }, ["Start the party →"]);
  const cancelBtn = el("button", { class: "glass-button" }, ["Back"]);
  cancelBtn.addEventListener("click", opts.onCancel);
  startBtn.disabled = selected.size === 0;
  startBtn.addEventListener("click", () => {
    if (selected.size === 0) return;
    opts.onStart([...selected], teamModeEnabled ? { ...teams } : null);
  });

  const cards = opts.games.map((g) => {
    const card = el("div", { class: "glass-card game-card anim-pop-in selected" }, [
      el("span", { class: "icon" }, [ICONS[g.id] ?? "🎮"]),
      el("h3", { class: "title-md" }, [g.title]),
      el("p", { class: "text-caption" }, [`${g.minPlayers}-${g.maxPlayers} players`]),
    ]);
    card.addEventListener("click", () => {
      if (selected.has(g.id)) {
        selected.delete(g.id);
        card.classList.remove("selected");
      } else {
        selected.add(g.id);
        card.classList.add("selected");
      }
      startBtn.disabled = selected.size === 0;
    });
    return card;
  });

  const pickerSection = el("div", {}, [
    el("p", { class: "text-caption" }, ["Tap games to include them, then start — the order gets shuffled."]),
    el(
      "div",
      { class: "game-select-grid" },
      cards.length ? cards : [el("p", { class: "text-body" }, ["Not enough players connected for any game yet."])],
    ),
  ]);

  // Team Mode: deliberately fixed at 2 teams — every existing game's own internal scoring,
  // voting, and vote-exclusion logic is untouched; this only groups the already-computed
  // per-player standings into two running totals for the party's cumulative leaderboard.
  const teamRows = opts.players.map((p) => {
    const teamBtn = el("button", { class: "glass-button", style: "padding:0.3em 0.8em;font-size:0.8em" }, [TEAM_LABELS[teams[p.id]]]);
    teamBtn.addEventListener("click", () => {
      teams[p.id] = teams[p.id] === "A" ? "B" : "A";
      teamBtn.textContent = TEAM_LABELS[teams[p.id]];
    });
    return el("div", { class: "glass-pill", style: "display:flex;align-items:center;gap:0.6em;justify-content:space-between;width:100%" }, [
      el("span", { style: "display:flex;align-items:center;gap:0.5em" }, [createAvatarSvg(p.id, p.color), p.name]),
      teamBtn,
    ]);
  });

  const teamSection = el("div", { style: "display:none;flex-direction:column;gap:0.5em;margin-top:1em" }, [
    el("p", { class: "text-caption" }, ["Tap a player to move them between teams."]),
    ...teamRows,
  ]);

  const teamToggle = el("button", { class: "glass-button" }, ["👥 Team Mode"]);
  const teamCaption = el("p", { class: "text-caption" }, ["Off — everyone competes individually."]);
  teamToggle.addEventListener("click", () => {
    teamModeEnabled = !teamModeEnabled;
    teamToggle.classList.toggle("accent", teamModeEnabled);
    teamSection.style.display = teamModeEnabled ? "flex" : "none";
    teamCaption.textContent = teamModeEnabled
      ? "On — standings are tracked per team too."
      : "Off — everyone competes individually.";
  });

  root.replaceChildren(
    // width:100% — an unstyled wrapper shrink-to-fits inside #app's centered flex; with
    // few/sparse cards that can collapse the grid below its own minmax() track minimum.
    el("div", { style: "width:100%" }, [
      el("div", { class: "screen-header" }, [
        el("h2", { class: "title-lg" }, ["Build your party"]),
        teamToggle,
        teamCaption,
        teamSection,
      ]),
      pickerSection,
      el("div", { style: "display:flex;gap:0.8em;justify-content:center;margin-top:1.6em" }, [cancelBtn, startBtn]),
    ]),
  );
  mountAmbientBackground(root);
}
