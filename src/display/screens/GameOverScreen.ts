import { el } from "@shared/dom";
import type { PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";
import type { TeamAssignments, TeamId } from "./PartySetupScreen";

export function scoreboard(players: PlayerInfo[], scores: Record<string, number>): HTMLElement {
  const ranked = [...players].map((p) => ({ p, score: scores[p.id] ?? 0 })).sort((a, b) => b.score - a.score);
  const rows = ranked.map(({ p, score }, i) =>
    el("div", { class: "glass-pill scoreboard-row anim-pop-in" }, [
      el("span", { class: "rank" }, [`${i + 1}`]),
      createAvatarSvg(p.id, p.color),
      el("span", { style: "flex:1" }, [p.name]),
      el("span", { class: "mono" }, [`${score}`]),
    ]),
  );
  return el("div", { class: "scoreboard" }, rows.length ? rows : [el("p", { class: "text-body" }, ["No scores yet."])]);
}

const TEAM_LABELS: Record<TeamId, string> = { A: "Team A", B: "Team B" };

export function teamScoreboard(players: PlayerInfo[], teams: TeamAssignments, teamStandings: Record<string, number>): HTMLElement {
  const rows = (["A", "B"] as TeamId[]).map((team) => {
    const members = players.filter((p) => teams[p.id] === team);
    return el("div", { class: "glass-pill scoreboard-row anim-pop-in", style: "flex-direction:column;align-items:stretch;gap:0.4em;padding:0.8em 1em" }, [
      el("div", { style: "display:flex;justify-content:space-between;align-items:center;width:100%" }, [
        el("span", { class: "title-md" }, [TEAM_LABELS[team]]),
        el("span", { class: "mono" }, [`${teamStandings[team] ?? 0}`]),
      ]),
      el("div", { style: "display:flex;gap:0.4em;flex-wrap:wrap" }, members.map((p) => createAvatarSvg(p.id, p.color, { size: "1.6em" }))),
    ]);
  });
  return el("div", { class: "scoreboard" }, rows);
}

export function renderGameOverScreen(
  root: HTMLElement,
  opts: {
    players: PlayerInfo[];
    scores: Record<string, number>;
    standings: Record<string, number>;
    onPlayAgain: () => void;
    onBackToMenu: () => void;
  },
): void {
  const playAgain = el("button", { class: "glass-button accent" }, ["Play again"]);
  playAgain.addEventListener("click", opts.onPlayAgain);
  const backToMenu = el("button", { class: "glass-button" }, ["Choose another game"]);
  backToMenu.addEventListener("click", opts.onBackToMenu);

  root.replaceChildren(
    el("div", { class: "screen-header" }, [el("h2", { class: "title-lg" }, ["Game over"])]),
    el("div", { class: "gameover-layout" }, [
      el("div", { class: "glass-panel lobby-panel anim-pop-in" }, [
        el("p", { class: "text-caption" }, ["This round"]),
        scoreboard(opts.players, opts.scores),
        playAgain,
        backToMenu,
      ]),
      el("div", { class: "glass-panel lobby-panel anim-pop-in" }, [
        el("p", { class: "text-caption" }, ["Standings — this session"]),
        scoreboard(opts.players, opts.standings),
      ]),
    ]),
  );
}
