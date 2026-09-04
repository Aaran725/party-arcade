import { describe, it, expect, vi } from "vitest";
import type { WebSocket } from "ws";
import { RoomManager } from "../rooms/RoomManager";
import { handleMessage, type ConnectionState } from "./handlers";

const OPEN = 1;
function fakeSocket(): WebSocket & { send: ReturnType<typeof vi.fn> } {
  return { readyState: OPEN, OPEN, send: vi.fn() } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}

const serverInfo = { lanUrlBase: "https://test.local:8443" };

describe("game:start server-side player-count guard", () => {
  it("rejects starting a game below its minPlayers instead of starting it", () => {
    const manager = new RoomManager();
    const hostSocket = fakeSocket();
    const room = manager.createRoom(hostSocket);
    room.players.set("p1", {
      id: "p1",
      sessionToken: "t",
      name: "Alice",
      color: "#fff",
      socket: fakeSocket(),
      connected: true,
      joinedAt: Date.now(),
      leaveTimer: null,
      deviceId: "d1",
    });
    const hostState: ConnectionState = { role: "host", roomCode: room.code };

    // sleeper-agent requires 4-8 players; this room only has 1.
    handleMessage(manager, hostSocket, hostState, { type: "game:start", gameId: "sleeper-agent" }, serverInfo);

    expect(room.phase).not.toBe("in_game");
    const [sentRaw] = hostSocket.send.mock.calls.at(-1)!;
    const sent = JSON.parse(sentRaw as string);
    expect(sent.type).toBe("error");
    expect(sent.code).toBe("not_enough_players");
  });

  it("allows starting a game once minPlayers is met", () => {
    const manager = new RoomManager();
    const hostSocket = fakeSocket();
    const room = manager.createRoom(hostSocket);
    for (const id of ["p1", "p2"]) {
      room.players.set(id, {
        id,
        sessionToken: "t",
        name: id,
        color: "#fff",
        socket: fakeSocket(),
        connected: true,
        joinedAt: Date.now(),
        leaveTimer: null,
        deviceId: id,
      });
    }
    const hostState: ConnectionState = { role: "host", roomCode: room.code };

    // draw-off requires 2-8 players; this room has exactly 2.
    handleMessage(manager, hostSocket, hostState, { type: "game:start", gameId: "draw-off" }, serverInfo);

    expect(room.phase).toBe("in_game");
  });
});

describe("input relay rate limiting", () => {
  it("drops a burst of input messages from the same socket faster than the throttle floor", () => {
    const manager = new RoomManager();
    const hostSocket = fakeSocket();
    const room = manager.createRoom(hostSocket);
    const playerSocket = fakeSocket();
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
    const controllerState: ConnectionState = { role: "controller", roomCode: room.code, playerId: "p1" };

    for (let i = 0; i < 20; i++) {
      handleMessage(manager, playerSocket, controllerState, { type: "input:tap", ts: Date.now() }, serverInfo);
    }

    // All 20 calls landed within the same throttle window — only the first should have
    // reached the host, exactly mirroring the existing player:reaction throttle's contract.
    expect(hostSocket.send).toHaveBeenCalledTimes(1);
  });
});
