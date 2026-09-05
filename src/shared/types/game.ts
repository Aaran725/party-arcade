import type { InputMessage, ServerToClientMessage, WildcardMechanic } from "@shared/protocol/messages";
import type { GameId, GameMeta, PlayerInfo } from "@shared/types/room";

export interface DisplayGameContext {
  root: HTMLElement;
  players: PlayerInfo[];
  meta: GameMeta;
  onScoreUpdate: (playerId: string, score: number) => void;
  onGameOver: (scores: Record<string, number>) => void;
  /** Send a private, per-player payload only that player's controller receives. */
  sendPrivate: (playerId: string, payload: unknown) => void;
  /** Request AI (with local-heuristic fallback) ratings for a batch of drawings — response arrives via DisplayGameModule.onRatingsResult. */
  requestRating: (word: string, submissions: { playerId: string; imageData: string }[]) => void;
  /** Request a speech-to-text transcription of one recorded clip — response arrives via DisplayGameModule.onTranscriptionResult. */
  requestTranscription: (playerId: string, audioData: string) => void;
  /** Request an AI-generated scenario (falls back server-side if the AI call fails, so this always resolves) — response arrives via DisplayGameModule.onScenarioResult. */
  requestScenario: () => void;
  /** Have the AI Game Leader read a line aloud, if one is currently mounted — a silent no-op otherwise, same resilience contract as the Leader's own party-transition lines. */
  hostSpeak: (text: string) => void;
  /** Request an AI-picked mini-game mechanic + generated content (falls back server-side, so this always resolves) — response arrives via DisplayGameModule.onWildcardResult. */
  requestWildcard: () => void;
  /** Opt-in: stash one highlight image (a data URL) + caption for this game, captured at whatever moment the game itself considers its own best "reveal" — the Party Recap Reel picks up whatever was last set here when the game ends. Silently ignored outside a party run. Call at most meaningfully once per game (a later call simply replaces the earlier one). */
  setHighlight: (imageDataUrl: string, caption: string) => void;
}

export interface DisplayGameModule {
  id: GameId;
  init(ctx: DisplayGameContext): void;
  tick(dt: number): void;
  onInput(playerId: string, msg: InputMessage): void;
  onPlayerLeave(playerId: string): void;
  /** Optional: current scores on demand, used when the host ends a round early. */
  getScores?(): Record<string, number>;
  /** Optional: AI/heuristic drawing ratings, requested via ctx and delivered async — only Draw-Off implements this. */
  onRatingsResult?(ratings: { playerId: string; score: number | null; comment: string | null }[]): void;
  /** Optional: speech-to-text result for one clip, requested via ctx and delivered async — only Echo Chain implements this. */
  onTranscriptionResult?(playerId: string, text: string | null): void;
  /** Optional: AI-generated scenario text, requested via ctx and delivered async — only Plot Twist implements this. */
  onScenarioResult?(scenario: string): void;
  /** Optional: AI-picked mechanic + generated content, requested via ctx and delivered async — only AI Wildcard implements this. */
  onWildcardResult?(round: { mechanic: WildcardMechanic; prompt: string; choices?: string[] }): void;
  destroy(): void;
}

export interface ControllerGameContext {
  root: HTMLElement;
  playerId: string;
  color: string;
  meta: GameMeta;
  sendInput: (msg: InputMessage) => void;
}

export interface ControllerGameModule {
  id: GameId;
  init(ctx: ControllerGameContext): void;
  onServerMessage(msg: ServerToClientMessage): void;
  destroy(): void;
}
