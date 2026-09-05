import type { Server as HTTPServer } from "node:http";
import type { Server as HTTPSServer } from "node:https";
import { WebSocketServer, type WebSocket } from "ws";
import { APP_WS_PATH } from "@shared/protocol/constants";
import type { ClientToServerMessage } from "@shared/protocol/messages";
import { RoomManager } from "./rooms/RoomManager";
import { type ConnectionState, type ServerInfo, handleMessage } from "./protocol/handlers";
import { broadcastToControllers, broadcastToSpectators, sendToHost } from "./protocol/broadcast";

const HEARTBEAT_INTERVAL_MS = 10_000;
// Generous enough for a full-resolution base64 drawing/photo frame with room to spare —
// just there to stop an oversized-frame flood, not to pinch any real payload.
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

interface HeartbeatState {
  alive: boolean;
}

// Accepts either — production always passes an https.Server, but the underlying `ws`
// upgrade mechanism (and this function's own usage of it) works identically over plain
// HTTP, which is exactly what scripts/chaos-test.ts uses to avoid needing a real cert.
export function attachWebSocketServer(httpsServer: HTTPServer | HTTPSServer, lanUrlBase: () => string): RoomManager {
  const roomManager = new RoomManager();
  const wss = new WebSocketServer({ server: httpsServer, path: APP_WS_PATH, maxPayload: MAX_PAYLOAD_BYTES });

  httpsServer.on("error", (err) => console.error("[ws-server] https server error:", err));
  wss.on("error", (err) => console.error("[ws-server] websocket server error:", err));

  const heartbeats = new WeakMap<WebSocket, HeartbeatState>();
  const heartbeatTimer = setInterval(() => {
    for (const socket of wss.clients) {
      const hb = heartbeats.get(socket);
      if (!hb) continue;
      if (!hb.alive) {
        // No pong since the last ping — treat as a dead connection (e.g. a real Wi-Fi
        // drop, not a clean close) instead of leaving it registered indefinitely.
        socket.terminate();
        continue;
      }
      hb.alive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on("close", () => clearInterval(heartbeatTimer));

  wss.on("connection", (socket: WebSocket) => {
    const state: ConnectionState = { role: "unassigned" };
    // A socket-level "error" with no listener is one of Node's classic uncaught-exception
    // traps (EventEmitter throws if nobody's listening) — this alone would have been enough
    // to take the whole server down on one flaky phone connection.
    socket.on("error", (err) => console.error("[ws-server] socket error:", err));
    heartbeats.set(socket, { alive: true });
    socket.on("pong", () => {
      const hb = heartbeats.get(socket);
      if (hb) hb.alive = true;
    });

    socket.on("message", (raw) => {
      let msg: ClientToServerMessage;
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        // "null", "123", "[1,2]" etc. all parse successfully but aren't a message object —
        // reject here rather than letting handleMessage's switch throw on `.type` (still
        // caught below either way, but this keeps that path for genuine handler bugs).
        if (typeof parsed !== "object" || parsed === null) return;
        msg = parsed as ClientToServerMessage;
      } catch {
        return;
      }
      const serverInfo: ServerInfo = { lanUrlBase: lanUrlBase() };
      try {
        handleMessage(roomManager, socket, state, msg, serverInfo);
      } catch (err) {
        // A bad message must never crash/close the connection — that would drop the
        // client into a reconnect loop and re-trigger a full room:resumed re-render.
        console.error("[ws-server] handleMessage error:", err);
      }
    });

    socket.on("close", () => {
      if (state.role === "host" && state.roomCode) {
        const room = roomManager.getRoom(state.roomCode);
        if (room) {
          // A stale/superseded host socket's own close must not tear down a room that
          // a newer connection (display:resume) already reattached to — same race shape
          // as the controller guard below.
          if (room.hostSocket !== socket) return;
          broadcastToControllers(room, { type: "error", code: "host_disconnected", message: "The host disconnected. Waiting for reconnect…" });
          roomManager.markHostDisconnected(room, () => {
            broadcastToControllers(room, { type: "error", code: "room_closed", message: "The game host closed the room." });
          });
        }
        return;
      }

      if (state.role === "controller" && state.roomCode && state.playerId) {
        const room = roomManager.getRoom(state.roomCode);
        if (!room) return;
        const player = room.players.get(state.playerId);
        if (!player) return;
        // This socket was superseded by a reconnect before its own close event fired —
        // without this guard, the old socket's close would immediately undo the
        // reconnect (re-broadcast room:player_left, restart the grace timer).
        if (player.socket !== socket) return;
        player.connected = false;
        sendToHost(room, { type: "room:player_left", playerId: state.playerId });
        broadcastToControllers(room, { type: "room:player_left", playerId: state.playerId }, state.playerId);
        broadcastToSpectators(room, { type: "room:player_left", playerId: state.playerId });

        player.leaveTimer = setTimeout(() => {
          room.players.delete(state.playerId!);
        }, roomManager.playerGraceMs);
        return;
      }

      if (state.role === "spectator" && state.roomCode) {
        const room = roomManager.getRoom(state.roomCode);
        room?.spectatorSockets.delete(socket);
      }
    });
  });

  return roomManager;
}
