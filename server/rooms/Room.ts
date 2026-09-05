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
  // Watch-only sockets — no player slot, no reconnect/leave-timer machinery needed, a
  // dropped spectator just reopens the link (see server/protocol/handlers.ts's
  // "spectator:join" and ws-server.ts's close handling).
  spectatorSockets: Set<WebSocket> = new Set();

  constructor(code: string, hostSocket: WebSocket) {
    this.code = code;
    this.hostSocket = hostSocket;
    this.createdAt = Date.now();
  }
}
