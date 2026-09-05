import { el, transitionOut } from "@shared/dom";
import { PROTOCOL_VERSION } from "@shared/protocol/constants";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import type { ArcadeSocket } from "@shared/ws-client";
import type { GameId, GameMeta, PlayerInfo } from "@shared/types/room";
import { THEMES } from "./game-runtime/theme";
import { pickStandingsBlurb } from "@shared/party-commentary";
import { renderLobbyScreen, updateLobbyPlayers } from "./screens/LobbyScreen";
import { renderGameSelectScreen, renderCalibrationWaitScreen } from "./screens/GameSelectScreen";
import { renderHallOfFameScreen } from "./screens/HallOfFameScreen";
import { renderGameOverScreen } from "./screens/GameOverScreen";
import { renderPartySetupScreen, type TeamAssignments } from "./screens/PartySetupScreen";
import { renderPartyNextScreen } from "./screens/PartyNextScreen";
import { renderPartyFinaleScreen } from "./screens/PartyFinaleScreen";
import { renderPartyRecapScreen } from "./screens/PartyRecapScreen";
import { eligibleGames, buildPartyQueue, type PartyHistoryEntry } from "./party/PartySession";
import { pickNextGameAutopilot, isCloseCall } from "./party/autopilot";
import { GameStage } from "./game-runtime/GameStage";
import { HostControls } from "./HostControls";
import { GameLeaderToggle } from "./host/GameLeaderToggle";
import { AutopilotToggle } from "./host/AutopilotToggle";
import type { AIHost } from "./host/AIHost";
import { pickWelcomeLine, nextGameLine, pickFinaleLine, pickAutopilotLine } from "@shared/game-leader-lines";
import { unlockAudio, setMasterVolume, setMasterMuted } from "@shared/audio";
import { renderQrCode } from "./qrcode";
import { ReactionBuzzerDisplay } from "./games/reaction-buzzer/DisplayModule";
import { TiltMazeDisplay } from "./games/tilt-maze/DisplayModule";
import { LaserBlasterDisplay } from "./games/laser-blaster/DisplayModule";
import { FruitSliceDisplay } from "./games/fruit-slice/DisplayModule";
import { SimonSaysDisplay } from "./games/simon-says/DisplayModule";
import { PaintWarsDisplay } from "./games/paint-wars/DisplayModule";
import { TriviaBuzzerDisplay } from "./games/trivia-buzzer/DisplayModule";
import { SleeperAgentDisplay } from "./games/sleeper-agent/DisplayModule";
import { DoodleRelayDisplay } from "./games/doodle-relay/DisplayModule";
import { DrawOffDisplay } from "./games/draw-off/DisplayModule";
import { ScreamRoyaleDisplay } from "./games/scream-royale/DisplayModule";
import { SnapJudgmentDisplay } from "./games/snap-judgment/DisplayModule";
import { EchoChainDisplay } from "./games/echo-chain/DisplayModule";
import { PlotTwistDisplay } from "./games/plot-twist/DisplayModule";
import { PushBattleDisplay } from "./games/push-battle/DisplayModule";
import { AiWildcardDisplay } from "./games/ai-wildcard/DisplayModule";
import { HotPotatoDisplay } from "./games/hot-potato/DisplayModule";
import { HostReactions } from "./HostReactions";
import { playWaveRipple } from "./host/waveRipple";

type Phase = "connecting" | "lobby" | "select" | "party-setup" | "calibrate" | "game" | "party-next" | "gameover" | "party-recap" | "party-finale";

// The room code used to live only in memory, so *reloading the TV tab* (or the browser
// discarding a backgrounded tab) minted a brand-new code via display:create and stranded
// every phone already in the room. Persisting it means a reload resumes the same room —
// the server already supports display:resume and can even rehydrate from its own snapshot.
const ROOM_CODE_KEY = "arcade:display-room";

function loadStoredRoomCode(): string {
  try {
    return localStorage.getItem(ROOM_CODE_KEY) ?? "";
  } catch {
    return ""; // private browsing / storage disabled — falls back to minting a fresh room
  }
}

function storeRoomCode(code: string): void {
  try {
    localStorage.setItem(ROOM_CODE_KEY, code);
  } catch {
    // Non-fatal: the room still works for this page load, it just won't survive a reload.
  }
}

export class DisplayRouter {
  private phase: Phase = "connecting";
  private roomCode = loadStoredRoomCode();
  private lanUrl = "";
  private games: GameMeta[] = [];
  private players = new Map<string, PlayerInfo>();
  private currentGameId: GameId | null = null;
  private calibrateReadyIds = new Set<string>();
  private lastScores: Record<string, number> = {};
  private standings = new Map<string, number>();
  private paused = false;

  private partyQueue: GameId[] = [];
  private partyIndex = -1; // -1 = not in a party
  private partyHistory: PartyHistoryEntry[] = [];
  private achievementsThisParty: { playerId: string; achievementIds: string[] }[] = [];
  private standingsBeforeCurrentGame: Record<string, number> = {};

  private teams: TeamAssignments | null = null;
  private teamStandings = new Map<string, number>();

  private gameLeaderEnabled = false;
  private autopilotEnabled = false;
  // "Since the last game ended" energy signals for the Autopilot Party Director
  // (src/display/party/autopilot.ts) — reset in startGame(), incremented as messages
  // arrive during the game that's currently playing, read by advanceParty() once that
  // game ends to decide what comes next.
  private reactionsSinceLastGame = 0;
  private achievementsSinceLastGame = 0;
  // Permanently attached (hidden until mounted) rather than re-parented per screen — the
  // Leader needs to keep speaking (and stay visible) through actual gameplay too, when
  // GameStage.mount() replaces the rest of #app's children wholesale.
  private leaderContainer: HTMLElement;
  private hostSpeechResolve: ((audioData: string | null) => void) | null = null;
  private avatarSessionResolve: ((sessionToken: string | null) => void) | null = null;
  private errorToast: HTMLElement | null = null;
  private qrOverlay: HTMLElement | null = null;
  private masterVolume = 0.5;
  private masterMuted = false;

  private stage: GameStage;
  // Lazily created — simli-client pulls in real WebRTC/LiveKit deps, so it's only ever
  // downloaded once a room actually turns the Game Leader on, not on every display load.
  private aiHost: AIHost | null = null;
  private gameLeaderToggle: GameLeaderToggle;
  private hostControls: HostControls;
  private hostReactions: HostReactions;

  constructor(private root: HTMLElement, private socket: ArcadeSocket) {
    this.leaderContainer = document.createElement("div");
    this.leaderContainer.className = "leader-avatar-host";
    this.leaderContainer.style.display = "none";
    document.body.append(this.leaderContainer);

    this.stage = new GameStage(
      this.root,
      {
        "reaction-buzzer": () => new ReactionBuzzerDisplay(),
        "tilt-maze": () => new TiltMazeDisplay(),
        "laser-blaster": () => new LaserBlasterDisplay(),
        "fruit-slice": () => new FruitSliceDisplay(),
        "simon-says": () => new SimonSaysDisplay(),
        "paint-wars": () => new PaintWarsDisplay(),
        "trivia-buzzer": () => new TriviaBuzzerDisplay(),
        "sleeper-agent": () => new SleeperAgentDisplay(),
        "doodle-relay": () => new DoodleRelayDisplay(),
        "draw-off": () => new DrawOffDisplay(),
        "scream-royale": () => new ScreamRoyaleDisplay(),
        "snap-judgment": () => new SnapJudgmentDisplay(),
        "echo-chain": () => new EchoChainDisplay(),
        "plot-twist": () => new PlotTwistDisplay(),
        "push-battle": () => new PushBattleDisplay(),
        "ai-wildcard": () => new AiWildcardDisplay(),
        "hot-potato": () => new HotPotatoDisplay(),
      },
      (playerId, score) => this.socket.send({ type: "display:score_update", playerId, score }),
      (playerId, payload) => this.socket.send({ type: "display:private_message", playerId, payload }),
      (word, submissions) => this.socket.send({ type: "display:request_rating", word, submissions }),
      (playerId, audioData) => this.socket.send({ type: "display:request_transcription", playerId, audioData }),
      () => this.socket.send({ type: "display:request_scenario" }),
      (text) => this.hostSpeak(text),
      () => this.socket.send({ type: "display:request_wildcard" }),
    );

    this.gameLeaderToggle = new GameLeaderToggle((enabled) => this.setGameLeaderEnabled(enabled));
    new AutopilotToggle((enabled) => (this.autopilotEnabled = enabled));
    this.hostReactions = new HostReactions();

    this.hostControls = new HostControls(
      (playerId) => this.socket.send({ type: "host:kick_player", playerId }),
      () => this.setPaused(true),
      () => this.setPaused(false),
      () => this.stage.forceEnd(),
      () => this.endParty(),
      (volume) => this.setHostVolume(volume),
      () => this.setHostMuted(!this.masterMuted),
      () => this.showQrOverlay(),
      () => this.triggerWave(),
    );

    socket.onOpen(() => {
      if (this.roomCode) {
        socket.send({ type: "display:resume", roomCode: this.roomCode, protocolVersion: PROTOCOL_VERSION });
      } else {
        socket.send({ type: "display:create", protocolVersion: PROTOCOL_VERSION });
      }
    });
    socket.onMessage((msg) => this.handleMessage(msg));
  }

  private playerList(): PlayerInfo[] {
    return [...this.players.values()];
  }

  private syncHostControls(): void {
    this.hostControls.update(this.playerList(), this.phase === "game", this.paused, this.partyIndex >= 0, this.roomCode);
  }

  private setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.stage.pause();
      this.socket.send({ type: "host:pause_game" });
    } else {
      this.stage.resume();
      this.socket.send({ type: "host:resume_game" });
    }
    this.syncHostControls();
  }

  /** No request-correlation id exists for this round-trip (same as request_rating/_transcription/_scenario) — fine, since only one Game Leader line is ever spoken at a time. */
  private requestHostSpeech(text: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.hostSpeechResolve = resolve;
      this.socket.send({ type: "display:request_host_speech", text });
    });
  }

  private requestAvatarSession(): Promise<string | null> {
    return new Promise((resolve) => {
      this.avatarSessionResolve = resolve;
      this.socket.send({ type: "display:request_avatar_session" });
    });
  }

  private async getAiHost(): Promise<AIHost> {
    if (!this.aiHost) {
      const { AIHost } = await import("./host/AIHost");
      this.aiHost = new AIHost(
        (text) => this.requestHostSpeech(text),
        () => this.requestAvatarSession(),
      );
      // A freshly created instance starts at its own defaults (full volume, unmuted) —
      // sync it to whatever the host already chose via HostControls before this moment.
      this.aiHost.setVolume(this.masterVolume);
      this.aiHost.setMuted(this.masterMuted);
    }
    return this.aiHost;
  }

  /** HostControls' volume slider — covers the Display's own audio (synth SFX + the AI Leader's TTS voice), the shared PA everyone at the party actually hears. Phone-side sound is each player's own device and out of scope here. */
  private setHostVolume(volume: number): void {
    this.masterVolume = volume;
    setMasterVolume(volume);
    this.aiHost?.setVolume(volume);
    this.hostControls.updateAudio(this.masterVolume, this.masterMuted);
  }

  private setHostMuted(muted: boolean): void {
    this.masterMuted = muted;
    setMasterMuted(muted);
    this.aiHost?.setMuted(muted);
    this.hostControls.updateAudio(this.masterVolume, this.masterMuted);
  }

  /** Every connected phone flashes/vibrates/sounds in a staggered ripple — the server computes the actual per-player delay from that room's stable join order (server/protocol/handlers.ts's "display:trigger_wave"), this just asks for it. Safe to call with zero players connected — the server simply has nobody to iterate. */
  private triggerWave(): void {
    this.socket.send({ type: "display:trigger_wave" });
    playWaveRipple(this.playerList());
  }

  /** Re-shows the room QR code mid-party — the one real scenario this covers is a dead/new phone joining after the lobby has already scrolled past. Reuses the exact same renderQrCode() call LobbyScreen makes. */
  private showQrOverlay(): void {
    if (this.qrOverlay) {
      this.qrOverlay.remove();
      this.qrOverlay = null;
      return;
    }
    const canvas = el("canvas", { class: "qr-canvas" });
    const closeBtn = el("button", { class: "glass-button" }, ["Close"]);
    closeBtn.addEventListener("click", () => this.showQrOverlay());
    this.qrOverlay = el("div", { style: "position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6)" }, [
      el("div", { class: "glass-panel lobby-panel anim-pop-in" }, [
        el("p", { class: "text-caption" }, ["Scan to join"]),
        canvas,
        el("div", { class: "glass-pill room-code mono" }, [this.roomCode]),
        closeBtn,
      ]),
    ]);
    document.body.append(this.qrOverlay);
    void renderQrCode(canvas, this.lanUrl);
  }

  /** Wired into every DisplayGameModule as ctx.hostSpeak — a silent no-op if the Leader isn't currently on, so games can call it unconditionally. */
  private hostSpeak(text: string): void {
    if (this.gameLeaderEnabled && this.aiHost) void this.aiHost.speak(text);
  }

  /** The GameLeaderToggle pill's callback — mount() needs this exact click as its user-gesture (browser audio-unlock) trigger, so this can't be deferred to a later screen's button. */
  private setGameLeaderEnabled(enabled: boolean): void {
    if (!enabled) {
      this.resetGameLeader();
      return;
    }
    this.leaderContainer.style.display = "block";
    void this.getAiHost()
      .then((host) => host.mount(this.leaderContainer))
      .then((ok) => {
        this.gameLeaderEnabled = ok;
        if (!ok) {
          this.leaderContainer.style.display = "none";
          this.gameLeaderToggle.reset();
          this.showErrorToast("Game Leader unavailable — check your Simli/Groq API keys.");
        }
      });
  }

  private resetGameLeader(): void {
    this.aiHost?.unmount();
    this.leaderContainer.style.display = "none";
    this.gameLeaderEnabled = false;
    this.gameLeaderToggle.reset();
  }

  /** A server-side rejection (e.g. "not enough players") needs to actually reach the host, not just the console — this is the one visible surface for it. */
  private showErrorToast(message: string): void {
    this.errorToast?.remove();
    this.errorToast = el(
      "div",
      { class: "glass-panel anim-pop-in", style: "position:fixed;top:1em;left:50%;transform:translateX(-50%);z-index:29;padding:0.8em 1.2em;max-width:70vw" },
      [el("p", { class: "text-body" }, [message])],
    );
    document.body.append(this.errorToast);
    setTimeout(() => {
      this.errorToast?.remove();
      this.errorToast = null;
    }, 4000);
  }

  private handleMessage(msg: ServerToClientMessage): void {
    switch (msg.type) {
      case "room:created":
        this.roomCode = msg.roomCode;
        storeRoomCode(msg.roomCode);
        this.lanUrl = msg.lanUrl;
        this.games = msg.games;
        this.players.clear();
        this.standings.clear();
        this.phase = "lobby";
        this.renderLobby();
        this.syncHostControls();
        return;

      case "room:resumed": {
        this.roomCode = msg.roomCode;
        storeRoomCode(msg.roomCode);
        this.lanUrl = msg.lanUrl;
        this.games = msg.games;
        this.players.clear();
        for (const p of msg.players) this.players.set(p.id, p);
        // A resumed connection always lands back in the lobby rather than trying to
        // rebuild mid-game state — the room code and player list survive, which is
        // what matters for a brief Wi-Fi drop; an in-flight game round (or party) does not.
        this.stage.stop();
        this.paused = false;
        this.resetGameLeader();
        this.partyQueue = [];
        this.partyIndex = -1;
        this.partyHistory = [];
        this.achievementsThisParty = [];
        this.standingsBeforeCurrentGame = {};
        this.renderLobby();
        this.syncHostControls();
        return;
      }

      case "room:lan_url_changed":
        this.lanUrl = msg.lanUrl;
        this.showErrorToast("Network changed — showing a fresh QR code.");
        this.qrOverlay?.remove();
        this.qrOverlay = null;
        this.showQrOverlay();
        return;

      case "room:player_joined":
        this.players.set(msg.player.id, msg.player);
        this.updateLobbyIfShown();
        this.syncHostControls();
        return;

      case "room:player_left": {
        const p = this.players.get(msg.playerId);
        if (p) p.connected = false;
        this.updateLobbyIfShown();
        this.stage.onPlayerLeave(msg.playerId);
        this.syncHostControls();
        return;
      }

      case "room:player_reconnected": {
        const p = this.players.get(msg.playerId);
        if (p) p.connected = true;
        this.updateLobbyIfShown();
        this.syncHostControls();
        return;
      }

      case "game:calibrate_progress":
        this.calibrateReadyIds.add(msg.playerId);
        if (this.phase === "calibrate") this.renderCalibrate();
        return;

      case "relay:input":
        this.stage.onInput(msg.playerId, msg.input);
        return;

      case "game:reaction":
        this.hostReactions.spawn(msg.playerId, msg.emoji);
        this.reactionsSinceLastGame++;
        return;

      case "game:ratings_result":
        this.stage.onRatingsResult(msg.ratings);
        return;

      case "game:transcription_result":
        this.stage.onTranscriptionResult(msg.playerId, msg.text);
        return;

      case "game:scenario_result":
        this.stage.onScenarioResult(msg.scenario);
        return;

      case "game:hall_of_fame_result":
        transitionOut(this.root);
        renderHallOfFameScreen(this.root, { entries: msg.entries, onBack: () => this.renderSelect() });
        return;

      case "game:wildcard_result":
        this.stage.onWildcardResult({ mechanic: msg.mechanic, prompt: msg.prompt, choices: msg.choices });
        return;

      case "game:host_speech_result":
        this.hostSpeechResolve?.(msg.audioData);
        this.hostSpeechResolve = null;
        return;

      case "game:avatar_session_result":
        this.avatarSessionResolve?.(msg.sessionToken);
        this.avatarSessionResolve = null;
        return;

      case "room:achievement_unlocked":
        this.achievementsThisParty.push({ playerId: msg.playerId, achievementIds: msg.achievementIds });
        this.achievementsSinceLastGame++;
        return;

      case "error":
        console.warn("[arcade] server error:", msg.code, msg.message);
        this.showErrorToast(msg.message);
        return;
    }
  }

  private renderLobby(): void {
    this.phase = "lobby";
    this.setGlassTint(null);
    transitionOut(this.root);
    renderLobbyScreen(this.root, {
      roomCode: this.roomCode,
      lanUrl: this.lanUrl,
      players: this.playerList(),
      onContinue: () => this.renderSelect(),
    });
  }

  /** Updates the already-mounted lobby in place; falls back to a full render if it isn't showing yet. */
  private updateLobbyIfShown(): void {
    if (this.phase !== "lobby") return;
    if (!updateLobbyPlayers(this.root, this.playerList())) this.renderLobby();
  }

  private renderSelect(): void {
    this.phase = "select";
    this.setGlassTint(null);
    transitionOut(this.root);
    renderGameSelectScreen(this.root, {
      games: this.games,
      players: this.playerList(),
      onSelect: (gameId) => this.selectGame(gameId),
      onStartParty: () => this.renderPartySetup(),
      onShowHallOfFame: () => this.renderHallOfFame(),
    });
    this.syncHostControls();
  }

  private renderHallOfFame(): void {
    this.socket.send({ type: "display:request_hall_of_fame" });
  }

  private renderPartySetup(): void {
    this.phase = "party-setup";
    transitionOut(this.root);
    renderPartySetupScreen(this.root, {
      games: eligibleGames(this.games, this.playerList().length),
      players: this.playerList(),
      onStart: (gameIds, teams) => this.startParty(gameIds, teams),
      onCancel: () => this.renderSelect(),
    });
    this.syncHostControls();
  }

  private startParty(gameIds: GameId[], teams: TeamAssignments | null): void {
    if (gameIds.length === 0) return;
    this.partyQueue = buildPartyQueue(gameIds);
    this.partyIndex = -1;
    this.partyHistory = [];
    this.achievementsThisParty = [];
    this.standings.clear();
    this.standingsBeforeCurrentGame = {};
    this.teams = teams;
    this.teamStandings.clear();
    this.advanceParty();
  }

  /** Advances to the next queued game (a "next up" transition), or the finale if the queue is exhausted. */
  private advanceParty(): void {
    this.partyIndex++;
    if (this.partyIndex >= this.partyQueue.length) {
      this.renderPartyRecap();
      return;
    }

    let nextId: GameId;
    let autopilotReason: string | null = null;
    if (this.autopilotEnabled) {
      const remainingPool = this.partyQueue.map((id) => this.games.find((g) => g.id === id)).filter((g): g is GameMeta => !!g);
      const lastEntry = this.partyHistory[this.partyHistory.length - 1];
      const picked = pickNextGameAutopilot(remainingPool, {
        reactionsSinceLastGame: this.reactionsSinceLastGame,
        achievementsSinceLastGame: this.achievementsSinceLastGame,
        lastGameWasCloseCall: lastEntry ? isCloseCall(lastEntry.scores) : false,
        playedThisParty: new Set(this.partyHistory.map((h) => h.gameId)),
      });
      nextId = picked.meta.id;
      autopilotReason = picked.reason;
    } else {
      nextId = this.partyQueue[this.partyIndex];
    }

    const meta = this.games.find((g) => g.id === nextId);
    if (!meta) {
      this.advanceParty(); // defensive: shouldn't happen, eligibleGames already filtered the selection
      return;
    }
    const currentStandings = Object.fromEntries(this.standings);
    const blurb = pickStandingsBlurb({
      standings: currentStandings,
      players: this.playerList(),
      previousStandings: this.standingsBeforeCurrentGame,
    });
    this.standingsBeforeCurrentGame = currentStandings;
    this.phase = "party-next";
    transitionOut(this.root);
    const { advance } = renderPartyNextScreen(this.root, {
      nextGame: meta,
      standingsBlurb: blurb,
      standings: currentStandings,
      players: this.playerList(),
      roundNumber: this.partyIndex + 1,
      totalRounds: this.partyQueue.length,
      onContinue: () => this.selectGame(nextId),
      holdAutoAdvance: this.gameLeaderEnabled,
      teams: this.teams ?? undefined,
      teamStandings: this.teams ? Object.fromEntries(this.teamStandings) : undefined,
    });
    this.syncHostControls();

    if (this.gameLeaderEnabled && this.aiHost) {
      const intro = autopilotReason ? pickAutopilotLine(meta.title, autopilotReason) : nextGameLine(meta.title, meta.description);
      const line = this.partyIndex === 0 ? `${pickWelcomeLine()} ${intro}` : `${blurb} ${intro}`;
      void this.aiHost.speak(line).then(advance);
    }
  }

  /** A produced highlight reel before the scoreboard — superlatives, captured drawings/photos, and achievements unlocked this party, narrated by the Leader when it's on. Hands off to the existing finale screen when it's done. */
  private renderPartyRecap(): void {
    this.phase = "party-recap";
    this.setGlassTint(null);
    transitionOut(this.root);
    this.triggerWave();
    const players = this.playerList();
    const standings = Object.fromEntries(this.standings);
    // Spectators aren't part of the normal broadcast path — this is the one explicit
    // round-trip through the server so they get the exact same recap everyone else does.
    this.socket.send({
      type: "display:party_recap",
      players,
      standings,
      history: this.partyHistory,
      achievements: this.achievementsThisParty,
    });
    renderPartyRecapScreen(this.root, {
      players,
      standings,
      history: this.partyHistory,
      achievements: this.achievementsThisParty,
      onCard: (line) => this.hostSpeak(line),
      onDone: () => this.renderPartyFinale(),
    });
  }

  private renderPartyFinale(): void {
    this.phase = "party-finale";
    this.setGlassTint(null);
    const finalStandings = Object.fromEntries(this.standings);
    transitionOut(this.root);
    renderPartyFinaleScreen(this.root, {
      players: this.playerList(),
      standings: finalStandings,
      history: this.partyHistory,
      achievements: this.achievementsThisParty,
      onNewParty: () => {
        this.partyQueue = [];
        this.partyIndex = -1;
        this.partyHistory = [];
        this.achievementsThisParty = [];
        this.teams = null;
        this.teamStandings.clear();
        this.renderSelect();
      },
      teams: this.teams ?? undefined,
      teamStandings: this.teams ? Object.fromEntries(this.teamStandings) : undefined,
    });
    this.syncHostControls();

    if (this.gameLeaderEnabled && this.aiHost) {
      const ranked = Object.entries(finalStandings).sort((a, b) => b[1] - a[1]);
      const winnerName = ranked[0] ? this.playerList().find((p) => p.id === ranked[0][0])?.name ?? "the winner" : "the winner";
      void this.aiHost.speak(pickFinaleLine(winnerName));
    }
  }

  /** Host-initiated early exit from a party, only offered between rounds — see HostControls. */
  private endParty(): void {
    this.partyQueue = [];
    this.partyIndex = -1;
    this.partyHistory = [];
    this.achievementsThisParty = [];
    this.standingsBeforeCurrentGame = {};
    this.teams = null;
    this.teamStandings.clear();
    this.renderSelect();
  }

  /** Blends a touch of the active game's own theme accent into every .glass-* surface's background (glass.css's --glass-tint) — cleared back to transparent (its tokens.css default, a full no-op) once back at the menu. */
  private setGlassTint(gameId: GameId | null): void {
    document.documentElement.style.setProperty("--glass-tint", gameId ? THEMES[gameId].accent : "transparent");
  }

  private selectGame(gameId: GameId): void {
    const meta = this.games.find((g) => g.id === gameId);
    if (!meta) return;
    unlockAudio(); // this click is the user gesture Web Audio needs — every game selection passes through here
    this.currentGameId = gameId;
    this.calibrateReadyIds.clear();
    this.setGlassTint(gameId);
    this.socket.send({ type: "game:select", gameId });

    if (meta.requiresMotion) {
      this.phase = "calibrate";
      this.renderCalibrate();
    } else {
      this.startGame(gameId);
    }
  }

  private renderCalibrate(): void {
    const meta = this.games.find((g) => g.id === this.currentGameId)!;
    transitionOut(this.root);
    renderCalibrationWaitScreen(this.root, {
      meta,
      players: this.playerList(),
      readyIds: this.calibrateReadyIds,
      onStart: () => this.startGame(meta.id),
    });
  }

  private startGame(gameId: GameId): void {
    const meta = this.games.find((g) => g.id === gameId)!;
    this.phase = "game";
    this.paused = false;
    // Fresh energy read for whichever game is about to play — advanceParty() reads these
    // once it ends to decide the Autopilot Director's next pick.
    this.reactionsSinceLastGame = 0;
    this.achievementsSinceLastGame = 0;
    this.socket.send({ type: "game:start", gameId });
    transitionOut(this.root);
    this.stage.mount();
    this.stage.start(gameId, meta, this.playerList(), (scores) => this.endGame(scores));
    this.syncHostControls();
  }

  private endGame(scores: Record<string, number>): void {
    this.paused = false;
    this.lastScores = scores;
    for (const [playerId, score] of Object.entries(scores)) {
      this.standings.set(playerId, (this.standings.get(playerId) ?? 0) + score);
      if (this.teams) {
        const team = this.teams[playerId];
        if (team) this.teamStandings.set(team, (this.teamStandings.get(team) ?? 0) + score);
      }
    }
    this.socket.send({ type: "game:over", scores });
    // Cumulative party standings only ever exist here (this.standings) — the server sees
    // one game's scores at a time — so this is the one place spectators' live leaderboard
    // can be kept accurate across multiple games, not just whichever one just ended.
    this.socket.send({ type: "display:standings_update", standings: Object.fromEntries(this.standings) });
    const highlight = this.stage.getLastHighlight();
    this.stage.stop();

    if (this.partyIndex >= 0) {
      if (this.currentGameId) {
        this.partyHistory.push({
          gameId: this.currentGameId,
          scores,
          highlightImage: highlight?.imageDataUrl,
          highlightCaption: highlight?.caption,
        });
      }
      this.advanceParty();
    } else {
      this.phase = "gameover";
      transitionOut(this.root);
      renderGameOverScreen(this.root, {
        players: this.playerList(),
        scores: this.lastScores,
        standings: Object.fromEntries(this.standings),
        onPlayAgain: () => this.currentGameId && this.selectGame(this.currentGameId),
        onBackToMenu: () => this.renderSelect(),
      });
      if (this.gameLeaderEnabled && this.aiHost) {
        const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const winnerName = ranked[0] ? this.playerList().find((p) => p.id === ranked[0][0])?.name ?? "the winner" : "the winner";
        void this.aiHost.speak(pickFinaleLine(winnerName));
      }
    }
    this.syncHostControls();
  }
}
