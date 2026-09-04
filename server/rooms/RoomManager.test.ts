import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WebSocket } from "ws";
import { RoomManager } from "./RoomManager";

const fakeSocket = {} as WebSocket;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RoomManager", () => {
  it("creates rooms with unique codes, retrievable case-insensitively", () => {
    const manager = new RoomManager();
    const room = manager.createRoom(fakeSocket);
    expect(manager.getRoom(room.code)).toBe(room);
    expect(manager.getRoom(room.code.toLowerCase())).toBe(room);
    expect(manager.getRoom("NOPE99")).toBeUndefined();
  });

  it("deletes a room and forgets it", () => {
    const manager = new RoomManager();
    const room = manager.createRoom(fakeSocket);
    manager.deleteRoom(room.code);
    expect(manager.getRoom(room.code)).toBeUndefined();
  });

  it("expires a room after the host grace period if never cancelled", () => {
    const manager = new RoomManager();
    const room = manager.createRoom(fakeSocket);
    const onExpire = vi.fn();

    manager.markHostDisconnected(room, onExpire);
    expect(manager.getRoom(room.code)).toBe(room); // still alive mid-grace

    vi.advanceTimersByTime(30_000);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(manager.getRoom(room.code)).toBeUndefined();
  });

  it("cancelling a host disconnect before the grace period keeps the room alive", () => {
    const manager = new RoomManager();
    const room = manager.createRoom(fakeSocket);
    const onExpire = vi.fn();

    manager.markHostDisconnected(room, onExpire);
    vi.advanceTimersByTime(10_000);
    manager.cancelHostDisconnect(room);
    vi.advanceTimersByTime(30_000);

    expect(onExpire).not.toHaveBeenCalled();
    expect(manager.getRoom(room.code)).toBe(room);
  });

  it("reports the configured player grace period", () => {
    expect(new RoomManager().playerGraceMs).toBe(30_000);
  });

  it("finds a room by a player's socket", () => {
    const manager = new RoomManager();
    const room = manager.createRoom(fakeSocket);
    const playerSocket = {} as WebSocket;
    room.players.set("p1", {
      id: "p1",
      sessionToken: "t",
      name: "Alice",
      color: "#fff",
      socket: playerSocket,
      connected: true,
      joinedAt: Date.now(),
      leaveTimer: null,
      deviceId: "d1",
    });

    const found = manager.findRoomByPlayerSocket(playerSocket);
    expect(found?.room).toBe(room);
    expect(found?.playerId).toBe("p1");
    expect(manager.findRoomByPlayerSocket({} as WebSocket)).toBeUndefined();
  });
});
