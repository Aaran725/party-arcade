import { el } from "@shared/dom";
import type { InputMessage, WildcardMechanic } from "@shared/protocol/messages";
import type { DisplayGameModule } from "@shared/types/game";
import type { GameMeta, PlayerInfo } from "@shared/types/room";
import { HUDOverlay } from "../screens/HUDOverlay";
import { GameLoop } from "./loop";
import type { GameId } from "@shared/types/room";

type ModuleFactory = () => DisplayGameModule;

export class GameStage {
  private wrap: HTMLElement;
  private canvasRoot: HTMLElement;
  private hud: HUDOverlay | null = null;
  private loop: GameLoop;
  private activeModule: DisplayGameModule | null = null;
  private playerNames = new Map<string, string>();
  private onGameOverCallback: ((scores: Record<string, number>) => void) | null = null;
  private lastHighlight: { imageDataUrl: string; caption: string } | null = null;
  // Guards against a game ending twice for the same session. Several game modules delay
  // their own natural onGameOver call by a few hundred ms (setTimeout, for a confetti/
  // fanfare beat) without tracking or cancelling that timer — if the host taps "End round"
  // during that window, forceEnd() below fires onGameOver immediately, and the module's
  // now-orphaned timer fires the *same* onGameOver closure again shortly after (that
  // closure was bound at start() and doesn't go through this class's own null checks, so
  // clearing state in stop() alone can't stop it). Without this flag that second call
  // double-counts the round's scores into party standings and double-fires everything
  // downstream of "game over." Whichever path — a module's own tick(), or forceEnd() —
  // calls fireGameOver() first wins; the loser is silently dropped.
  private gameOverFired = false;

  constructor(
    private container: HTMLElement,
    private factories: Record<GameId, ModuleFactory>,
    private onScoreBroadcast: (playerId: string, score: number) => void,
    private onPrivateMessage: (playerId: string, payload: unknown) => void,
    private onRequestRating: (word: string, submissions: { playerId: string; imageData: string }[]) => void,
    private onRequestTranscription: (playerId: string, audioData: string) => void,
    private onRequestScenario: () => void,
    private onHostSpeak: (text: string) => void,
    private onRequestWildcard: () => void,
  ) {
    this.canvasRoot = el("div", { class: "canvas-root", style: "position:absolute;inset:0" });
    this.wrap = el("div", { class: "stage-wrap anim-pop-in" }, [this.canvasRoot]);
    this.loop = new GameLoop((dt) => this.activeModule?.tick(dt));
  }

  mount(): void {
    this.container.replaceChildren(this.wrap);
  }

  start(gameId: GameId, meta: GameMeta, players: PlayerInfo[], onGameOver: (scores: Record<string, number>) => void): void {
    this.stop();
    this.playerNames = new Map(players.map((p) => [p.id, p.name]));
    this.canvasRoot.replaceChildren();
    this.hud = new HUDOverlay(this.wrap, players);
    this.onGameOverCallback = onGameOver;
    this.lastHighlight = null;
    this.gameOverFired = false;

    const factory = this.factories[gameId];
    const module = factory();
    this.activeModule = module;
    module.init({
      root: this.canvasRoot,
      players,
      meta,
      onScoreUpdate: (playerId, score) => this.setScore(playerId, score),
      onGameOver: (scores) => this.fireGameOver(scores),
      sendPrivate: (playerId, payload) => this.onPrivateMessage(playerId, payload),
      requestRating: (word, submissions) => this.onRequestRating(word, submissions),
      requestTranscription: (playerId, audioData) => this.onRequestTranscription(playerId, audioData),
      requestScenario: () => this.onRequestScenario(),
      hostSpeak: (text) => this.onHostSpeak(text),
      requestWildcard: () => this.onRequestWildcard(),
      setHighlight: (imageDataUrl, caption) => {
        this.lastHighlight = { imageDataUrl, caption };
      },
    });
    this.loop.start();
  }

  /** Whatever the just-finished game last passed to ctx.setHighlight(), if anything — read this right when onGameOver fires, before the next start() clears it. */
  getLastHighlight(): { imageDataUrl: string; caption: string } | null {
    return this.lastHighlight;
  }

  onInput(playerId: string, msg: InputMessage): void {
    // Guarded like the GameLoop's tick (game-runtime/loop.ts): onInput is where several
    // games mutate scores and drive phase transitions, so one malformed input must not
    // escape into the socket handler and strand the whole room mid-game.
    try {
      this.activeModule?.onInput(playerId, msg);
    } catch (err) {
      console.error("[GameStage] onInput error:", err);
    }
  }

  onRatingsResult(ratings: { playerId: string; score: number | null; comment: string | null }[]): void {
    this.activeModule?.onRatingsResult?.(ratings);
  }

  onTranscriptionResult(playerId: string, text: string | null): void {
    this.activeModule?.onTranscriptionResult?.(playerId, text);
  }

  onScenarioResult(scenario: string): void {
    this.activeModule?.onScenarioResult?.(scenario);
  }

  onWildcardResult(round: { mechanic: WildcardMechanic; prompt: string; choices?: string[] }): void {
    this.activeModule?.onWildcardResult?.(round);
  }

  setScore(playerId: string, score: number): void {
    const name = this.playerNames.get(playerId) ?? "Player";
    this.hud?.setScore(playerId, name, score);
    this.onScoreBroadcast(playerId, score);
  }

  onPlayerLeave(playerId: string): void {
    this.activeModule?.onPlayerLeave(playerId);
  }

  pause(): void {
    this.loop.stop();
  }

  resume(): void {
    this.loop.start();
  }

  /** Host ended the round early — reuse the same completion path a natural finish uses. */
  forceEnd(): void {
    if (!this.activeModule) return;
    const scores = this.activeModule.getScores?.() ?? {};
    this.fireGameOver(scores);
  }

  /** The one gate every "the round just ended" path funnels through — see gameOverFired above. */
  private fireGameOver(scores: Record<string, number>): void {
    if (this.gameOverFired) return;
    this.gameOverFired = true;
    this.onGameOverCallback?.(scores);
  }

  stop(): void {
    this.loop.stop();
    this.hud?.destroy();
    this.hud = null;
    this.activeModule?.destroy();
    this.activeModule = null;
    this.onGameOverCallback = null;
  }
}
