import { el, transitionOut } from "@shared/dom";
import { vibrate, vibrateSilent } from "./input/haptics";
import { sfx } from "./sfx";
import { flashWave } from "./components/waveFlash";
import { requestWakeLock, releaseWakeLock, reacquireWakeLockOnVisible } from "./input/wakeLock";
import { PROTOCOL_VERSION } from "@shared/protocol/constants";
import type { ClientToServerMessage, ServerToClientMessage, StoredProfileSnapshot } from "@shared/protocol/messages";
import type { ArcadeSocket } from "@shared/ws-client";
import type { ControllerGameModule } from "@shared/types/game";
import type { GameId, GameMeta, PlayerInfo, RoomPhase } from "@shared/types/room";
import { renderJoinScreen } from "./screens/JoinScreen";
import { renderWaitingRoomScreen, roomPresenceStrip } from "./screens/WaitingRoomScreen";
import { renderCareerScreen } from "./screens/CareerScreen";
import { renderReconnectingScreen } from "./screens/ReconnectingScreen";
import { renderEnableMotionScreen } from "./screens/EnableMotionScreen";
import { renderCalibrateScreen } from "./screens/CalibrateScreen";
import { ReactionBuzzerController } from "./games/reaction-buzzer/ControllerModule";
import { TiltMazeController } from "./games/tilt-maze/ControllerModule";
import { LaserBlasterController } from "./games/laser-blaster/ControllerModule";
import { FruitSliceController } from "./games/fruit-slice/ControllerModule";
import { SimonSaysController } from "./games/simon-says/ControllerModule";
import { PaintWarsController } from "./games/paint-wars/ControllerModule";
import { TriviaBuzzerController } from "./games/trivia-buzzer/ControllerModule";
import { SleeperAgentController } from "./games/sleeper-agent/ControllerModule";
import { DoodleRelayController } from "./games/doodle-relay/ControllerModule";
import { DrawOffController } from "./games/draw-off/ControllerModule";
import { ScreamRoyaleController } from "./games/scream-royale/ControllerModule";
import { SnapJudgmentController } from "./games/snap-judgment/ControllerModule";
import { EchoChainController } from "./games/echo-chain/ControllerModule";
import { PlotTwistController } from "./games/plot-twist/ControllerModule";
import { PushBattleController } from "./games/push-battle/ControllerModule";
import { AiWildcardController } from "./games/ai-wildcard/ControllerModule";
import { HotPotatoController } from "./games/hot-potato/ControllerModule";
import { ReactionTray } from "./ReactionTray";

type ModuleFactory = () => ControllerGameModule;

interface StoredSession {
  playerId: string;
  sessionToken: string;
  name: string;
  color: string;
}

/**
 * This phone's own copy of its Career profile — the durable one.
 *
 * The server's store lives on a filesystem the free hosting tier throws away whenever the
 * instance spins down, so it cannot be the system of record: every cold start used to wipe
 * everyone's stats, achievements and the whole Hall of Fame. Keeping a copy here and
 * offering it back on join means the server's store heals itself as people reconnect,
 * without standing up a database for a party game.
 */
const PROFILE_KEY = "arcade:profile";

function loadStoredProfile(): StoredProfileSnapshot | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as StoredProfileSnapshot) : null;
  } catch {
    return null; // storage unavailable, or a corrupt entry — just don't offer one
  }
}

function storeProfile(profile: StoredProfileSnapshot): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Non-fatal: this session still works, it just won't help restore anything later.
  }
}

const CALIBRATE_INSTRUCTIONS: Record<GameId, string> = {
  "reaction-buzzer": "",
  "tilt-maze": "Hold your phone flat, then tap Calibrate to set your neutral tilt.",
  "laser-blaster": "Point your phone at the screen like a laser, then tap Calibrate.",
  "fruit-slice": "Point your phone at the screen, then tap Calibrate.",
  "simon-says": "",
  "paint-wars": "Point your phone at the screen, then tap Calibrate.",
  "trivia-buzzer": "",
  "sleeper-agent": "",
  "doodle-relay": "",
  "draw-off": "",
  "scream-royale": "",
  "snap-judgment": "",
  "echo-chain": "",
  "plot-twist": "",
  "push-battle": "",
  "ai-wildcard": "",
  "hot-potato": "Get ready to shake!",
};

export class ControllerRouter {
  private roomCode: string;
  private playerId = "";
  private sessionToken = "";
  private color = "";
  private name = "";
  // "unknown" until a real phase-bearing message has been processed at least once — must
  // not default to a real RoomPhase value, or a cold restore landing in a room that's
  // genuinely still in "lobby" would look like a no-op transport blip and never render.
  private phase: RoomPhase | "unknown" = "unknown";
  private activeMeta: GameMeta | null = null;
  private activeModule: ControllerGameModule | null = null;
  private myScore = 0;
  private scoreBadge: HTMLElement | null = null;
  private pauseBanner: HTMLElement | null = null;
  private deviceId: string;
  private achievementToast: HTMLElement | null = null;
  private levelUpToast: HTMLElement | null = null;
  private roster = new Map<string, PlayerInfo>();

  private factories: Record<GameId, ModuleFactory> = {
    "reaction-buzzer": () => new ReactionBuzzerController(),
    "tilt-maze": () => new TiltMazeController(),
    "laser-blaster": () => new LaserBlasterController(),
    "fruit-slice": () => new FruitSliceController(),
    "simon-says": () => new SimonSaysController(),
    "paint-wars": () => new PaintWarsController(),
    "trivia-buzzer": () => new TriviaBuzzerController(),
    "sleeper-agent": () => new SleeperAgentController(),
    "doodle-relay": () => new DoodleRelayController(),
    "draw-off": () => new DrawOffController(),
    "scream-royale": () => new ScreamRoyaleController(),
    "snap-judgment": () => new SnapJudgmentController(),
    "echo-chain": () => new EchoChainController(),
    "plot-twist": () => new PlotTwistController(),
    "push-battle": () => new PushBattleController(),
    "ai-wildcard": () => new AiWildcardController(),
    "hot-potato": () => new HotPotatoController(),
  };

  private reactionTray: ReactionTray | null = null;

  constructor(private root: HTMLElement, private socket: ArcadeSocket) {
    const params = new URLSearchParams(location.search);
    this.roomCode = (params.get("room") ?? "").toUpperCase();
    this.deviceId = this.getOrCreateDeviceId();

    socket.onMessage((msg) => this.handleMessage(msg));
    socket.onOpen(() => this.handleOpen());
    reacquireWakeLockOnVisible();

    const saved = this.loadSession();
    if (saved) {
      this.playerId = saved.playerId;
      this.sessionToken = saved.sessionToken;
      this.name = saved.name;
      this.color = saved.color;
      renderReconnectingScreen(this.root);
    } else {
      this.renderJoin();
    }
  }

  private send(msg: ClientToServerMessage): void {
    this.socket.send(msg);
  }

  // ---------- Session persistence ----------

  private sessionKey(): string {
    return `arcade:session:${this.roomCode}`;
  }

  private loadSession(): StoredSession | null {
    try {
      const raw = localStorage.getItem(this.sessionKey());
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  }

  private saveSession(): void {
    try {
      const session: StoredSession = {
        playerId: this.playerId,
        sessionToken: this.sessionToken,
        name: this.name,
        color: this.color,
      };
      localStorage.setItem(this.sessionKey(), JSON.stringify(session));
    } catch {
      // localStorage unavailable (private mode, etc.) — reconnect just won't survive a reload.
    }
  }

  private clearSession(): void {
    try {
      localStorage.removeItem(this.sessionKey());
    } catch {
      // ignore
    }
  }

  /** Global, not room-scoped like sessionKey() above — this is what links a Career profile to "this phone" across any room, any night, even a server restart. Not a real account; clearing browser storage resets it, same tradeoff the room session already accepts. */
  private getOrCreateDeviceId(): string {
    try {
      const key = "arcade:device-id";
      let id = localStorage.getItem(key);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(key, id);
      }
      return id;
    } catch {
      return crypto.randomUUID(); // localStorage unavailable — Career just won't persist between visits this session
    }
  }

  // ---------- Connection lifecycle ----------

  private handleOpen(): void {
    if (this.playerId && this.sessionToken) {
      this.send({
        type: "player:reconnect",
        roomCode: this.roomCode,
        playerId: this.playerId,
        sessionToken: this.sessionToken,
        protocolVersion: PROTOCOL_VERSION,
      });
    }
    // Otherwise: nothing to send yet. JoinScreen's onJoin() sends player:join whenever
    // the user submits; ArcadeSocket queues it automatically if not yet open.
  }

  private rosterList(): PlayerInfo[] {
    return [...this.roster.values()];
  }

  /** Shared shell for dead-end states (kicked, disconnected, room closed) that used to be a bare `<p>` with no way forward. */
  private renderStatusScreen(opts: { icon: string; message: string; actionLabel?: string; onAction?: () => void }): void {
    transitionOut(this.root);
    const children: (Node | string)[] = [
      el("div", { style: "font-size:2.6rem" }, [opts.icon]),
      el("p", { class: "text-body" }, [opts.message]),
    ];
    if (opts.actionLabel && opts.onAction) {
      const btn = el("button", { class: "glass-button accent" }, [opts.actionLabel]);
      btn.addEventListener("click", opts.onAction);
      children.push(btn);
    }
    this.root.replaceChildren(el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, children));
  }

  private renderJoin(error?: string): void {
    this.hideScoreBadge();
    this.hideReactionTray();
    transitionOut(this.root);
    renderJoinScreen(this.root, {
      roomCode: this.roomCode || "????",
      error,
      onJoin: (name) => {
        this.name = name;
        this.send({
          type: "player:join",
          roomCode: this.roomCode,
          name,
          protocolVersion: PROTOCOL_VERSION,
          deviceId: this.deviceId,
          storedProfile: loadStoredProfile() ?? undefined,
        });
      },
    });
  }

  private handleMessage(msg: ServerToClientMessage): void {
    switch (msg.type) {
      case "player:profile_sync":
        // Silent bookkeeping — deliberately no re-render. This phone is the durable copy
        // of its own Career: the server's store lives on a filesystem that's thrown away
        // on every cold start, so whatever we save here is what restores it next time.
        storeProfile(msg.profile);
        return;

      case "player:joined":
        this.playerId = msg.playerId;
        this.sessionToken = msg.sessionToken;
        this.color = msg.color;
        this.phase = "lobby";
        this.saveSession();
        this.renderWaitingRoom();
        this.showReactionTray();
        void requestWakeLock();
        return;

      case "room:wave":
        setTimeout(() => {
          vibrateSilent([30, 60, 30]);
          sfx.wave(msg.staggerIndex);
          flashWave(msg.color);
        }, msg.staggerIndex * msg.staggerMs);
        return;

      case "room:state_sync":
        this.roster.clear();
        for (const p of msg.players) this.roster.set(p.id, p);
        this.updateWaitingRoomIfShown();
        return;

      case "room:player_joined":
        this.roster.set(msg.player.id, msg.player);
        this.updateWaitingRoomIfShown();
        return;

      case "room:player_left": {
        const p = this.roster.get(msg.playerId);
        if (p) p.connected = false;
        this.updateWaitingRoomIfShown();
        return;
      }

      case "room:player_reconnected": {
        const p = this.roster.get(msg.playerId);
        if (p) p.connected = true;
        this.updateWaitingRoomIfShown();
        return;
      }

      case "player:join_rejected":
        this.renderJoin(this.rejectionMessage(msg.reason));
        return;

      case "player:reconnected":
        this.playerId = msg.playerId;
        this.color = msg.color;
        this.name = msg.name;
        this.saveSession();
        this.showReactionTray();
        this.reconcilePhase(msg.phase, msg.currentGame, msg.games, msg.lastScores);
        void requestWakeLock();
        return;

      case "player:reconnect_failed":
        this.clearSession();
        this.playerId = "";
        this.sessionToken = "";
        this.renderJoin(this.reconnectFailureMessage(msg.reason));
        return;

      case "player:kicked":
        this.clearSession();
        this.playerId = "";
        this.sessionToken = "";
        releaseWakeLock();
        this.activeModule?.destroy();
        this.activeModule = null;
        this.hideScoreBadge();
        this.hideReactionTray();
        this.renderStatusScreen({
          icon: "🚪",
          message: "You were removed from the room by the host.",
          actionLabel: "Join a new room",
          onAction: () => this.renderJoin(),
        });
        return;

      case "game:selected":
        this.activeMeta = msg.meta;
        this.phase = msg.meta.requiresMotion ? "calibrating" : "selecting";
        if (!msg.meta.requiresMotion) {
          this.renderWaitingRoom();
        }
        return;

      case "game:calibrate_request":
        if (!this.activeMeta) return;
        transitionOut(this.root);
        renderEnableMotionScreen(this.root, {
          gameTitle: this.activeMeta.title,
          onGranted: () => this.showCalibrate(),
        });
        return;

      case "game:start":
        this.phase = "in_game";
        this.startGame(msg.gameId);
        return;

      case "game:over":
        this.phase = "game_over";
        this.endGame(msg.scores);
        return;

      case "game:score_update":
        if (msg.playerId === this.playerId) {
          this.myScore = msg.score;
          this.updateScoreBadge();
        }
        return;

      case "game:paused":
        this.setPaused(true);
        return;

      case "game:resumed":
        this.setPaused(false);
        return;

      case "error":
        if (msg.code === "room_closed") this.clearSession();
        if (msg.code === "room_closed" || msg.code === "host_disconnected" || msg.code === "session_replaced") {
          this.hideReactionTray();
          releaseWakeLock();
          // Was missing entirely — a mid-game disconnect left scream-royale's open mic
          // stream, or a drawing game's pointer listeners/ResizeObserver, still attached
          // to a screen that's about to be replaced.
          this.activeModule?.destroy();
          this.activeModule = null;
          const canRejoin = msg.code !== "room_closed" && this.playerId && this.sessionToken;
          this.renderStatusScreen({
            icon: msg.code === "room_closed" ? "🔒" : "📡",
            message: msg.message,
            actionLabel: canRejoin ? "Try rejoining" : "Join a new room",
            onAction: canRejoin ? () => location.reload() : () => this.renderJoin(),
          });
        }
        return;

      case "game:private_message":
        // The phone's mirror of the Display's GameLoop guard: a throw inside one game's
        // module must not take down the controller mid-party, on the device that's by far
        // the hardest to debug. Logged, not swallowed silently.
        try {
          this.activeModule?.onServerMessage(msg);
        } catch (err) {
          console.error("[controller] game module threw handling a private message:", err);
        }
        return;

      case "player:profile_result":
        transitionOut(this.root);
        renderCareerScreen(this.root, {
          id: this.playerId,
          name: this.name,
          color: this.color,
          data: msg,
          onBack: () => this.renderWaitingRoom(),
        });
        return;

      case "game:achievements_unlocked":
        this.showAchievementToast(msg.achievementIds);
        return;

      case "game:leveled_up":
        this.showLevelUpToast(msg.level);
        return;
    }
  }

  private requestCareer(): void {
    this.send({ type: "player:request_profile" });
  }

  private renderWaitingRoom(opts: { silent?: boolean } = {}): void {
    if (!opts.silent) transitionOut(this.root);
    renderWaitingRoomScreen(this.root, {
      id: this.playerId,
      name: this.name,
      color: this.color,
      players: this.rosterList(),
      onCareer: () => this.requestCareer(),
    });
  }

  /** Only re-renders when a room presence screen is actually showing — a mid-game roster change shouldn't touch whatever the active game module currently has on screen. Silent (no cross-fade) since this fires on every join/leave and shouldn't flicker. */
  private updateWaitingRoomIfShown(): void {
    if (this.phase === "lobby" || this.phase === "selecting") this.renderWaitingRoom({ silent: true });
    else if (this.phase === "in_game" && !this.activeModule) this.renderSittingOut({ silent: true });
  }

  private showAchievementToast(achievementIds: string[]): void {
    if (achievementIds.length === 0) return;
    vibrate([30, 60, 30]);
    this.achievementToast?.remove();
    this.achievementToast = el(
      "div",
      { class: "glass-panel anim-pop-in", style: "position:fixed;top:max(4em, env(safe-area-inset-top));left:1em;right:1em;z-index:15;padding:0.8em 1em;text-align:center" },
      [el("p", { class: "text-body" }, [`🏆 Achievement unlocked! (${achievementIds.length})`])],
    );
    document.body.append(this.achievementToast);
    setTimeout(() => {
      this.achievementToast?.remove();
      this.achievementToast = null;
    }, 4000);
  }

  /** Same shape and timing as showAchievementToast above — a level-up gets the identical immediate-phone-toast-plus-later-Recap-Reel-card treatment an achievement unlock already gets, no new interruption pattern invented for it. */
  private showLevelUpToast(level: number): void {
    vibrate([30, 60, 30]);
    this.levelUpToast?.remove();
    this.levelUpToast = el(
      "div",
      { class: "glass-panel anim-pop-in", style: "position:fixed;top:max(4em, env(safe-area-inset-top));left:1em;right:1em;z-index:15;padding:0.8em 1em;text-align:center" },
      [el("p", { class: "text-body" }, [`⬆️ Level ${level}!`])],
    );
    document.body.append(this.levelUpToast);
    setTimeout(() => {
      this.levelUpToast?.remove();
      this.levelUpToast = null;
    }, 4000);
  }

  /**
   * A `player:reconnected` message covers two different situations: a pure transport
   * blip (the tab never reloaded, the current screen is still correct — this round-trip
   * exists only to fix the server's bookkeeping) or a cold restore / a blip long enough
   * to miss a broadcast (ArcadeSocket doesn't replay missed messages). Only act when the
   * server's reported phase actually disagrees with what's already showing, so a blip
   * never interrupts a player mid-calibration or mid-round.
   */
  private reconcilePhase(
    phase: RoomPhase,
    currentGame: GameId | null,
    games: GameMeta[],
    lastScores: Record<string, number> | null,
  ): void {
    const localGameId = this.activeMeta?.id ?? null;
    if (phase === this.phase && currentGame === localGameId && (phase !== "in_game" || this.activeModule)) {
      return;
    }
    this.phase = phase;
    switch (phase) {
      case "lobby":
      case "selecting":
        this.hideScoreBadge();
        this.renderWaitingRoom();
        return;
      case "calibrating": {
        const meta = games.find((g) => g.id === currentGame);
        if (meta) {
          this.activeMeta = meta;
          this.showCalibrate();
        }
        return;
      }
      case "in_game":
        this.renderSittingOut();
        return;
      case "game_over":
        this.endGame(lastScores ?? {});
        return;
    }
  }

  private renderSittingOut(opts: { silent?: boolean } = {}): void {
    this.activeModule?.destroy();
    this.activeModule = null;
    this.hideScoreBadge();
    if (!opts.silent) transitionOut(this.root);
    this.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["You're back"]),
        el("p", { class: "text-body" }, ["Sit tight — you'll jump in next round."]),
        roomPresenceStrip(this.rosterList()),
      ]),
    );
  }

  private showCalibrate(): void {
    if (!this.activeMeta) return;
    const gameId = this.activeMeta.id;
    transitionOut(this.root);
    renderCalibrateScreen(this.root, {
      gameTitle: this.activeMeta.title,
      instructions: CALIBRATE_INSTRUCTIONS[gameId],
      onCalibrate: () => this.send({ type: "game:calibrate_ack" }),
    });
  }

  private startGame(gameId: GameId): void {
    const meta = this.activeMeta;
    if (!meta) return;
    this.activeModule?.destroy();
    this.myScore = 0;
    this.showScoreBadge();
    transitionOut(this.root);
    const module = this.factories[gameId]();
    this.activeModule = module;
    module.init({
      root: this.root,
      playerId: this.playerId,
      color: this.color,
      meta,
      sendInput: (input) => this.send(input),
    });
  }

  private endGame(scores: Record<string, number>): void {
    this.activeModule?.destroy();
    this.activeModule = null;
    this.hideScoreBadge();
    this.setPaused(false);
    const myScore = scores[this.playerId] ?? 0;
    transitionOut(this.root);
    this.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Game over"]),
        el("p", { class: "text-body" }, ["Check the big screen for the full leaderboard."]),
        el("p", { class: "title-lg mono" }, [`${myScore}`]),
      ]),
    );
  }

  // ---------- Live score badge (Part D: the phone shouldn't be silent all round) ----------

  private showScoreBadge(): void {
    if (this.scoreBadge) this.scoreBadge.remove();
    this.scoreBadge = el("div", { class: "glass-pill mono", style: "position:fixed;top:max(0.8em, env(safe-area-inset-top));right:1em;z-index:10" }, [
      "Score: 0",
    ]);
    document.body.append(this.scoreBadge);
  }

  private updateScoreBadge(): void {
    this.scoreBadge?.replaceChildren(`Score: ${this.myScore}`);
  }

  private hideScoreBadge(): void {
    this.scoreBadge?.remove();
    this.scoreBadge = null;
  }

  // ---------- Hype Reactions tray (Phase 5) ----------

  private showReactionTray(): void {
    if (this.reactionTray) return;
    this.reactionTray = new ReactionTray((emoji) => this.send({ type: "player:reaction", emoji }));
  }

  private hideReactionTray(): void {
    this.reactionTray?.destroy();
    this.reactionTray = null;
  }

  private setPaused(paused: boolean): void {
    if (paused) {
      if (this.pauseBanner) return;
      this.pauseBanner = el(
        "div",
        { class: "glass-panel anim-pop-in", style: "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:20;border-radius:0" },
        [el("p", { class: "title-md" }, ["Paused by host"])],
      );
      document.body.append(this.pauseBanner);
    } else {
      this.pauseBanner?.remove();
      this.pauseBanner = null;
    }
  }

  private rejectionMessage(reason: string): string {
    switch (reason) {
      case "room_not_found": return "Room not found — check the code and try again.";
      case "room_full": return "That room is full.";
      case "name_taken": return "That name is taken in this room — try another.";
      case "game_in_progress": return "A game is already in progress — wait for it to finish.";
      case "version_mismatch": return "App is out of date — reload the page.";
      default: return "Couldn't join — try again.";
    }
  }

  private reconnectFailureMessage(reason: string): string {
    switch (reason) {
      case "room_not_found": return "That room no longer exists — join a new one below.";
      case "session_invalid": return "Your session expired — rejoin below.";
      case "version_mismatch": return "App is out of date — reload the page.";
      default: return "Couldn't reconnect — rejoin below.";
    }
  }
}
