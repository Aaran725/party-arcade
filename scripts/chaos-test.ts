/**
 * A real WebSocket chaos test against the actual server code — not the fake-socket
 * integration tests in server/protocol/handlers.integration.test.ts (fast and
 * deterministic, but they call handleMessage() directly and never touch the real WS
 * upgrade path, real timing, or real concurrent chaos). This spins up
 * attachWebSocketServer() on a plain local HTTP server (no TLS needed — `ws` upgrades
 * work over plain HTTP) and throws real, concurrent chaos at it with the real `ws`
 * client: input floods well past the rate-limit floor, mid-session disconnect/reconnect
 * cycles using real session tokens, and malformed frames. Run with `npm run chaos-test`.
 */
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
// This run creates six throwaway `chaos-device-*` players, which used to land in the real
// data/players.json on every CI run. Point the stores at a temp dir instead. ESM hoists
// the imports above this line, but that's fine: playerStore/roomSnapshot resolve their
// data dir per call, not at module load, so this just has to beat the first actual read
// or write — which can't happen until a client connects further down.
process.env.PARTY_ARCADE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "party-arcade-chaos-"));

import { attachWebSocketServer } from "../server/ws-server";
import { PROTOCOL_VERSION, APP_WS_PATH } from "../src/shared/protocol/constants";
import type { ClientToServerMessage, ServerToClientMessage } from "../src/shared/protocol/messages";

const PORT = 8765; // separate from the real dev server's 8443 — this is a standalone, throwaway process
const NUM_PLAYERS = 6;
const DURATION_MS = 20_000;
const FLOOD_INTERVAL_MS = 2; // far faster than the ~8.3ms (1000/120) server-side rate-limit floor

let serverCrashed: unknown = null;
process.on("uncaughtException", (err) => (serverCrashed = err));
process.on("unhandledRejection", (err) => (serverCrashed = err));

function connect(): WebSocket {
  return new WebSocket(`ws://localhost:${PORT}${APP_WS_PATH}`);
}

function send(ws: WebSocket, msg: ClientToServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function onceType<T extends ServerToClientMessage["type"]>(
  ws: WebSocket,
  type: T,
): Promise<Extract<ServerToClientMessage, { type: T }>> {
  return new Promise((resolve) => {
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as ServerToClientMessage;
      if (msg.type === type) {
        ws.off("message", handler);
        resolve(msg as Extract<ServerToClientMessage, { type: T }>);
      }
    };
    ws.on("message", handler);
  });
}

interface PlayerState {
  id: string;
  ws: WebSocket;
  playerId: string;
  sessionToken: string;
  relayedCount: number;
  reconnectAttempts: number;
  reconnectSuccesses: number;
}

async function main() {
  const httpServer = createServer();
  const roomManager = attachWebSocketServer(httpServer, () => `http://localhost:${PORT}`);
  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
  console.log(`[chaos-test] server up on :${PORT}, spinning up ${NUM_PLAYERS} players for ${DURATION_MS / 1000}s...`);

  // ---- host ----
  const host = connect();
  await new Promise<void>((resolve) => host.once("open", resolve));
  send(host, { type: "display:create", protocolVersion: PROTOCOL_VERSION });
  const created = await onceType(host, "room:created");
  const roomCode = created.roomCode;

  let totalRelayed = 0;
  host.on("message", (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerToClientMessage;
    if (msg.type === "relay:input") totalRelayed++;
  });

  // ---- players ----
  const players: PlayerState[] = [];
  let totalSentByFlooders = 0;
  const floodingIds = new Set<number>();

  for (let i = 0; i < NUM_PLAYERS; i++) {
    const ws = connect();
    await new Promise<void>((resolve) => ws.once("open", resolve));
    const deviceId = `chaos-device-${i}`;
    send(ws, { type: "player:join", roomCode, name: `Chaos${i}`, protocolVersion: PROTOCOL_VERSION, deviceId });
    const joined = await onceType(ws, "player:joined");
    players.push({ id: `p${i}`, ws, playerId: joined.playerId, sessionToken: joined.sessionToken, relayedCount: 0, reconnectAttempts: 0, reconnectSuccesses: 0 });
    if (i % 2 === 0) floodingIds.add(i); // half the room floods input, half stays quiet as a control group
  }
  console.log(`[chaos-test] all ${NUM_PLAYERS} players joined room ${roomCode}`);

  // ---- chaos loop ----
  const floodTimers: NodeJS.Timeout[] = [];
  players.forEach((p, i) => {
    if (!floodingIds.has(i)) return;
    const timer = setInterval(() => {
      if (p.ws.readyState !== WebSocket.OPEN) return;
      totalSentByFlooders++;
      send(p.ws, { type: "input:tap", ts: Date.now() });
    }, FLOOD_INTERVAL_MS);
    floodTimers.push(timer);
  });

  // A couple of players disconnect and reconnect mid-run using their real session token —
  // exercises the grace-period reconnect path under real timing, not a synthetic call.
  const reconnectTargets = [players[1], players[3]].filter(Boolean);
  const reconnectSchedule = reconnectTargets.map((p, idx) =>
    setTimeout(async () => {
      p.reconnectAttempts++;
      p.ws.close();
      await new Promise((r) => setTimeout(r, 300 + idx * 150));
      const fresh = connect();
      await new Promise<void>((resolve) => fresh.once("open", resolve));
      send(fresh, { type: "player:reconnect", roomCode, playerId: p.playerId, sessionToken: p.sessionToken, protocolVersion: PROTOCOL_VERSION });
      const result = await Promise.race([
        onceType(fresh, "player:reconnected").then(() => true),
        onceType(fresh, "player:reconnect_failed").then(() => false),
      ]);
      if (result) p.reconnectSuccesses++;
      p.ws = fresh;
    }, 4000 + idx * 3000),
  );

  // Occasional malformed/garbage frames — must never crash the connection or the process.
  const garbageTimer = setInterval(() => {
    const p = players[Math.floor(Math.random() * players.length)];
    if (p.ws.readyState !== WebSocket.OPEN) return;
    const garbage = [
      "not json at all",
      JSON.stringify({ type: "input:tap" /* missing ts */ }),
      JSON.stringify({ type: "totally:unknown_message_type", whatever: 123 }),
      JSON.stringify(null),
    ];
    p.ws.send(garbage[Math.floor(Math.random() * garbage.length)]);
  }, 500);

  await new Promise((r) => setTimeout(r, DURATION_MS));

  floodTimers.forEach(clearInterval);
  clearInterval(garbageTimer);
  reconnectSchedule.forEach(clearTimeout); // no-ops for any that already fired — the DURATION_MS wait above already gave every scheduled reconnect (last one starts at 7s) ample room to complete its round-trip

  // ---- post-chaos health check: can a brand new client still complete a full round-trip? ----
  let serverStillResponsive = false;
  try {
    const probe = connect();
    await new Promise<void>((resolve, reject) => {
      probe.once("open", resolve);
      probe.once("error", reject);
    });
    send(probe, { type: "display:create", protocolVersion: PROTOCOL_VERSION });
    await Promise.race([onceType(probe, "room:created"), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))]);
    probe.close();
    serverStillResponsive = true;
  } catch {
    serverStillResponsive = false;
  }

  httpServer.close();

  // ---- report ----
  const reconnectAttempted = reconnectTargets.reduce((n, p) => n + p.reconnectAttempts, 0);
  const reconnectSucceeded = reconnectTargets.reduce((n, p) => n + p.reconnectSuccesses, 0);
  const rateLimitHeld = totalSentByFlooders > 0 && totalRelayed < totalSentByFlooders * 0.5;

  console.log("");
  console.log("=== chaos-test report ===");
  console.log(`server process survived (no uncaught crash): ${serverCrashed ? "FAIL" : "PASS"}`);
  if (serverCrashed) console.log(`  -> ${String(serverCrashed)}`);
  console.log(`server still responsive after chaos window:   ${serverStillResponsive ? "PASS" : "FAIL"}`);
  console.log(`rate limiter held (${totalSentByFlooders} sent -> ${totalRelayed} relayed): ${rateLimitHeld ? "PASS" : "FAIL"}`);
  console.log(`reconnects recovered: ${reconnectSucceeded}/${reconnectAttempted} ${reconnectSucceeded === reconnectAttempted && reconnectAttempted > 0 ? "PASS" : "FAIL"}`);
  console.log(`rooms still tracked cleanly: ${roomManager.allRooms().length >= 1 ? "PASS" : "FAIL"}`);
  console.log("");

  const passed = !serverCrashed && serverStillResponsive && rateLimitHeld && reconnectSucceeded === reconnectAttempted && reconnectAttempted > 0;
  if (!passed) process.exitCode = 1;
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error("[chaos-test] harness itself errored:", err);
  process.exit(1);
});
