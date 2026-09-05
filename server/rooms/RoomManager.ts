import type { WebSocket } from "ws";
import { Room } from "./Room";
import type { Player } from "./Player";
import { generateRoomCode } from "./codes";
import { deleteSnapshot } from "./roomSnapshot";

const HOST_GRACE_MS = 30_000;
const PLAYER_GRACE_MS = 30_000;

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(hostSocket: WebSocket): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new Room(code, hostSocket);
    this.rooms.set(code, room);
    return room;
  }

  /** Only ever used to rehydrate a room from a persisted snapshot (server/rooms/roomSnapshot.ts) after a process restart — a real create always calls createRoom() above, which picks its own fresh code. */
  createRoomWithCode(code: string, hostSocket: WebSocket): Room {
    const room = new Room(code, hostSocket);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  deleteRoom(code: string): void {
    this.rooms.delete(code);
  }

  markHostDisconnected(room: Room, onExpire: (room: Room) => void): void {
    if (room.hostLeaveTimer) clearTimeout(room.hostLeaveTimer);
    room.hostLeaveTimer = setTimeout(() => {
      // This is a genuine, deliberate close — the host never came back within the grace
      // period — not just a restart, which is exactly the case a snapshot needs to
      // survive. Delete it here so a truly abandoned room doesn't linger and get
      // rehydrated by a stray reconnect days later.
      deleteSnapshot(room.code);
      this.deleteRoom(room.code);
      onExpire(room);
    }, HOST_GRACE_MS);
  }

  cancelHostDisconnect(room: Room): void {
    if (room.hostLeaveTimer) {
      clearTimeout(room.hostLeaveTimer);
      room.hostLeaveTimer = null;
    }
  }

  get playerGraceMs(): number {
    return PLAYER_GRACE_MS;
  }

  cancelPlayerDisconnect(player: Player): void {
    if (player.leaveTimer) {
      clearTimeout(player.leaveTimer);
      player.leaveTimer = null;
    }
  }

  findRoomByPlayerSocket(socket: WebSocket): { room: Room; playerId: string } | undefined {
    for (const room of this.rooms.values()) {
      for (const [id, player] of room.players) {
        if (player.socket === socket) return { room, playerId: id };
      }
    }
    return undefined;
  }

  findRoomByHostSocket(socket: WebSocket): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.hostSocket === socket) return room;
    }
    return undefined;
  }

  allRooms(): Room[] {
    return [...this.rooms.values()];
  }
}
