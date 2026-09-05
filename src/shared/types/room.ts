/**
 * The single source of truth for the roster. `GameId` is derived from this array rather
 * than declared as a parallel union, so anything that needs to *count* the games (e.g. the
 * "played every game" achievement) can read `ALL_GAME_IDS.length` instead of maintaining a
 * hand-bumped constant that silently drifts behind the registry — which is exactly what
 * happened before: the constant said 16 while the roster had grown to 17, so the
 * achievement unlocked a game early.
 */
export const ALL_GAME_IDS = [
  "reaction-buzzer",
  "tilt-maze",
  "laser-blaster",
  "fruit-slice",
  "simon-says",
  "paint-wars",
  "trivia-buzzer",
  "sleeper-agent",
  "doodle-relay",
  "draw-off",
  "scream-royale",
  "snap-judgment",
  "echo-chain",
  "plot-twist",
  "push-battle",
  "ai-wildcard",
  "hot-potato",
] as const;

export type GameId = (typeof ALL_GAME_IDS)[number];

export type RoomPhase = "lobby" | "selecting" | "calibrating" | "in_game" | "game_over";

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  connected: boolean;
}

export interface GameMeta {
  id: GameId;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  requiresMotion: boolean;
  requiresPointer: boolean;
  requiresMicrophone?: boolean;
  requiresCamera?: boolean;
  /** The one real signal the Autopilot Party Director (src/display/party/autopilot.ts) uses to keep a party's energy up or deliberately change pace — not a UI label, just a tag on the underlying rhythm of the game (buzzer/reaction games are fast, deduction/drawing games are slow). */
  pace: "fast" | "medium" | "slow";
}
