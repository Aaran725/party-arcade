import type { WebSocket } from "ws";
import type { GameId, RoomPhase } from "@shared/types/room";
import type { Player } from "./Player";

export class Room {
  code: string;
  hostSocket: WebSocket;
  createdAt: number;
  players: Map<string, Player> = new Map();
  currentGame: GameId | null = null;
  phase: RoomPhase = "lobby";
  lastScores: Record<string, number> | null = null;
  hostLeaveTimer: NodeJS.Timeout | null = null;

  constructor(code: string, hostSocket: WebSocket) {
    this.code = code;
    this.hostSocket = hostSocket;
    this.createdAt = Date.now();
  }
}
