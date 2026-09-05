import type { WebSocket } from "ws";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import type { Room } from "../rooms/Room";

export function sendTo(socket: WebSocket, msg: ServerToClientMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

export function sendToHost(room: Room, msg: ServerToClientMessage): void {
  sendTo(room.hostSocket, msg);
}

export function broadcastToControllers(room: Room, msg: ServerToClientMessage, exceptPlayerId?: string): void {
  for (const [id, player] of room.players) {
    if (id === exceptPlayerId) continue;
    sendTo(player.socket, msg);
  }
}

export function broadcastRoom(room: Room, msg: ServerToClientMessage): void {
  sendToHost(room, msg);
  broadcastToControllers(room, msg);
}

/** Not folded into broadcastRoom() — most host/controller traffic (calibration, private per-player payloads) is irrelevant to a watch-only spectator, so this is called explicitly only at the sites that matter (score updates, game selection, reactions, party recap). */
export function broadcastToSpectators(room: Room, msg: ServerToClientMessage): void {
  for (const socket of room.spectatorSockets) sendTo(socket, msg);
}
