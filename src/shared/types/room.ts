export type GameId =
  | "reaction-buzzer"
  | "tilt-maze"
  | "laser-blaster"
  | "fruit-slice"
  | "simon-says"
  | "paint-wars"
  | "trivia-buzzer"
  | "sleeper-agent"
  | "doodle-relay"
  | "draw-off"
  | "scream-royale"
  | "snap-judgment"
  | "echo-chain"
  | "plot-twist"
  | "push-battle"
  | "ai-wildcard"
  | "hot-potato";

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
