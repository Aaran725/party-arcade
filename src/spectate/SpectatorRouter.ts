import { el, transitionOut } from "@shared/dom";
import type { ArcadeSocket } from "@shared/ws-client";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import type { GameId, GameMeta, PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";
import { ICONS } from "../display/screens/GameSelectScreen";
import { renderPartyRecapScreen } from "../display/screens/PartyRecapScreen";
import { renderPartyFinaleScreen } from "../display/screens/PartyFinaleScreen";

const REACTION_MS = 2600;

function roomCodeFromUrl(): string {
  return new URLSearchParams(location.search).get("room")?.trim().toUpperCase() ?? "";
}

/**
 * The watch-only companion view — a deliberately separate, much lighter bundle from the
 * Display's own Router.ts (which pulls in AIHost.ts's WebRTC avatar client at ~600KB for
 * something a spectator never needs). Reuses PartyRecapScreen/PartyFinaleScreen directly
 * since both are pure data-driven DOM with no canvas-gameplay dependency at all — a
 * spectator gets the exact same end-of-party payoff moment everyone else does.
 */
export class SpectatorRouter {
  private players = new Map<string, PlayerInfo>();
  private games: GameMeta[] = [];
  private standings: Record<string, number> = {};
  // This round's live deltas, separate from `standings` (cross-game cumulative totals) —
  // merged for display, reset whenever a new game is selected. Keeps the leaderboard
  // ticking within a round instead of only updating at game boundaries.
  private roundScores: Record<string, number> = {};
  private currentGame: GameId | null = null;
  private roomCode = "";
  private joined = false;

  constructor(
    private root: HTMLElement,
    socket: ArcadeSocket,
  ) {
    this.renderWaiting("Connecting…");
    socket.onOpen(() => {
      this.roomCode = roomCodeFromUrl();
      if (!this.roomCode) {
        this.renderWaiting("No room code in this link — ask the host for the \"Watch along\" link.");
        return;
      }
      socket.send({ type: "spectator:join", roomCode: this.roomCode });
    });
    socket.onClose(() => {
      if (this.joined) this.renderWaiting("Reconnecting…");
    });
    socket.onMessage((msg) => this.handleMessage(msg));
  }

  private handleMessage(msg: ServerToClientMessage): void {
    switch (msg.type) {
      case "spectator:joined":
        this.joined = true;
        this.roomCode = msg.roomCode;
        this.players = new Map(msg.players.map((p) => [p.id, p]));
        this.games = msg.games;
        this.currentGame = msg.currentGame;
        this.standings = msg.standings;
        this.roundScores = {};
        this.renderLive();
        return;
      case "spectator:join_rejected":
        this.renderWaiting("That room code doesn't exist — double-check the link.");
        return;
      case "room:player_joined":
        this.players.set(msg.player.id, msg.player);
        this.renderLive();
        return;
      case "room:player_left": {
        const p = this.players.get(msg.playerId);
        if (p) this.players.set(msg.playerId, { ...p, connected: false });
        this.renderLive();
        return;
      }
      case "room:player_reconnected": {
        const p = this.players.get(msg.playerId);
        if (p) this.players.set(msg.playerId, { ...p, connected: true });
        this.renderLive();
        return;
      }
      case "game:selected":
        this.currentGame = msg.gameId;
        this.roundScores = {};
        this.renderLive();
        return;
      case "game:score_update":
        this.roundScores[msg.playerId] = msg.score;
        this.renderLive();
        return;
      case "game:over":
        this.roundScores = {};
        this.renderLive();
        return;
      case "spectator:standings_update":
        this.standings = msg.standings;
        this.renderLive();
        return;
      case "game:reaction":
        this.showReaction(msg.emoji);
        return;
      case "spectator:party_recap":
        transitionOut(this.root);
        renderPartyRecapScreen(this.root, {
          players: msg.players,
          standings: msg.standings,
          history: msg.history,
          achievements: msg.achievements,
          onDone: () =>
            renderPartyFinaleScreen(this.root, {
              players: msg.players,
              standings: msg.standings,
              history: msg.history,
              achievements: msg.achievements,
              onNewParty: () => this.renderLive(),
            }),
        });
        return;
    }
  }

  private connectedPlayers(): PlayerInfo[] {
    return [...this.players.values()];
  }

  private mergedStandings(): Record<string, number> {
    const merged = { ...this.standings };
    for (const [id, score] of Object.entries(this.roundScores)) {
      merged[id] = (this.standings[id] ?? 0) + score;
    }
    return merged;
  }

  private renderWaiting(message: string): void {
    this.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h1", { class: "title-lg" }, ["👀 Watching along"]),
        el("p", { class: "text-body" }, [message]),
      ]),
    );
  }

  private renderLive(): void {
    const meta = this.games.find((g) => g.id === this.currentGame);
    const players = this.connectedPlayers();
    const standings = this.mergedStandings();
    const ranked = players.slice().sort((a, b) => (standings[b.id] ?? 0) - (standings[a.id] ?? 0));

    const leaderboard = ranked.length
      ? ranked.map((p) =>
          el("div", { class: "glass-pill anim-pop-in", style: `opacity:${p.connected ? 1 : 0.45}` }, [
            createAvatarSvg(p.id, p.color),
            p.name,
            el("span", { class: "mono" }, [String(standings[p.id] ?? 0)]),
          ]),
        )
      : [el("p", { class: "text-body anim-pulse" }, ["Waiting for players to join…"])];

    this.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-fade-in", style: "align-items:center;gap:1em" }, [
        el("p", { class: "text-caption" }, [`Room ${this.roomCode}`]),
        el("h1", { class: "title-lg" }, ["👀 Watching along"]),
        el("div", { class: "glass-card", style: "align-items:center;padding:1.2em;gap:0.3em" }, [
          el("span", { style: "font-size:2.4rem" }, [meta ? (ICONS[meta.id] ?? "🎮") : "🎲"]),
          el("p", { class: "text-body" }, [meta ? meta.title : "Waiting in the lobby…"]),
        ]),
        el("div", { class: "player-strip", style: "flex-direction:column;width:100%" }, leaderboard),
      ]),
    );
  }

  private showReaction(emoji: string): void {
    const spawnX = 20 + Math.random() * 60;
    const span = el("span", { class: "reaction-burst", style: `--spawn-x:${spawnX}vw` }, [emoji]);
    span.addEventListener("animationend", () => span.remove());
    document.body.append(span);
    setTimeout(() => span.remove(), REACTION_MS);
  }
}
