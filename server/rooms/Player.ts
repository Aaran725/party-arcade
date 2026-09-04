import type { WebSocket } from "ws";

export interface Player {
  id: string;
  sessionToken: string;
  name: string;
  color: string;
  socket: WebSocket;
  connected: boolean;
  joinedAt: number;
  leaveTimer: NodeJS.Timeout | null;
  /** Persists across rooms/server restarts — a device-generated id (src/controller/Router.ts), not a real account. Links this room's Player to a Career profile (server/storage/playerStore.ts). */
  deviceId: string;
}
