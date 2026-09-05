import type { PlayerInfo } from "@shared/types/room";
import type { InputMessage } from "@shared/protocol/messages";

export interface RankedResult {
  playerId: string;
  tally: number;
  rank: number;
  points: number;
}

export interface WildcardRoundData {
  prompt: string;
  choices?: string[];
  /** Mechanic-generated hidden target, created client-side by the Display before the round starts — an aim heading or a number-guess target. Never derived from the AI, same precedent the original aim mechanic already established. */
  secret?: number;
}

export interface DisplayMechanicHandler {
  /** Shown as the instruction line above the prompt, e.g. "VOTE ON YOUR PHONE". */
  label: string;
  /** Clears any state left over from the previous round of this mechanic. */
  reset(): void;
  /** Optional extra canvas drawing during the active phase (e.g. aim's compass rose). `accent` is the game theme's accent color. */
  drawExtra?(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, round: WildcardRoundData, accent: string): void;
  hasAnswered(playerId: string): boolean;
  handleInput(playerId: string, msg: InputMessage): void;
  resolve(players: PlayerInfo[], round: WildcardRoundData): RankedResult[];
  onPlayerLeave(playerId: string): void;
}
