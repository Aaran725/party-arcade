import fs from "node:fs";
import path from "node:path";
import type { GameId, RoomPhase } from "@shared/types/room";
import type { Room } from "./Room";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");
// A restart happening minutes into a party is the real case this exists for; a snapshot
// older than this is almost certainly an abandoned room from a party that's long over, not
// one worth resurrecting for a phone that finally wanders back into range.
const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

export interface RoomSnapshotPlayer {
  id: string;
  name: string;
  color: string;
  sessionToken: string;
  deviceId: string;
}

export interface RoomSnapshot {
  code: string;
  players: RoomSnapshotPlayer[];
  phase: RoomPhase;
  currentGame: GameId | null;
  lastScores: Record<string, number> | null;
  savedAt: number;
}

// Same flat-JSON-file pattern as server/storage/playerStore.ts — a local party app on
// someone's home network (or a single free-tier container) doesn't need a database for
// "survive a restart," and write volume here is a handful of events per room mutation.
let cache: Record<string, RoomSnapshot> | null = null;

function load(): Record<string, RoomSnapshot> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    cache = {};
  }
  return cache!;
}

function persist(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
}

/** Called at the handful of room-mutation points that matter (create, player join/leave, phase change, game select/over) — mirrors playerStore.ts's own "rewrite whole on every change" trade-off. */
export function saveSnapshot(room: Room): void {
  const store = load();
  store[room.code] = {
    code: room.code,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, sessionToken: p.sessionToken, deviceId: p.deviceId })),
    phase: room.phase,
    currentGame: room.currentGame,
    lastScores: room.lastScores,
    savedAt: Date.now(),
  };
  persist();
}

/** Undefined if there's no snapshot, or it's aged out — both treated identically by callers as "nothing to rehydrate," never a hard failure. */
export function loadSnapshot(code: string): RoomSnapshot | undefined {
  const snapshot = load()[code.toUpperCase()];
  if (!snapshot) return undefined;
  if (Date.now() - snapshot.savedAt > SNAPSHOT_MAX_AGE_MS) {
    deleteSnapshot(code);
    return undefined;
  }
  return snapshot;
}

/** Called when a room is actually, deliberately closed (the host's grace period truly expires) — not on every ordinary disconnect, which is exactly the case a snapshot needs to survive. */
export function deleteSnapshot(code: string): void {
  const store = load();
  delete store[code.toUpperCase()];
  persist();
}
