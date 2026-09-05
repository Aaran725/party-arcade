import fs from "node:fs";
import path from "node:path";
import type { GameId } from "@shared/types/room";
import { ACHIEVEMENTS, type PlayerStats } from "@shared/achievements";

// Resolved per call, not at module load, so tests and the chaos runner can point at a
// throwaway directory via PARTY_ARCADE_DATA_DIR instead of writing into the real
// data/players.json (which CI's chaos-test used to pollute with chaos-device-* rows).
function dataDir(): string {
  return process.env.PARTY_ARCADE_DATA_DIR ?? path.resolve(process.cwd(), "data");
}
function dataFile(): string {
  return path.join(dataDir(), "players.json");
}

export interface PlayerProfile extends PlayerStats {
  deviceId: string;
  name: string;
  achievements: string[];
  lastSeen: number;
}

// A flat JSON file, not a database — this is a local party app on someone's home
// network, not a hosted service, so this is the right amount of infrastructure for
// "remember stats across nights" rather than standing up something nobody asked for.
// Loaded once into memory and rewritten whole on every change; write volume here is a
// handful of events per game-over, nowhere near enough to need anything fancier.
let cache: Record<string, PlayerProfile> | null = null;

function load(): Record<string, PlayerProfile> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(dataFile(), "utf-8"));
  } catch {
    cache = {}; // first run, or a corrupt/missing file — start fresh rather than crash the server
  }
  return cache!;
}

function persist(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(cache, null, 2));
}

/** Test-only: drops the in-memory cache so the next read re-reads from disk. The cache is process-lifetime by design in production; tests need to swap data dirs between cases. */
export function resetStoreCacheForTests(): void {
  cache = null;
}

function blankProfile(deviceId: string, name: string): PlayerProfile {
  return { deviceId, name, gamesPlayed: 0, wins: 0, playCounts: {}, winsByGame: {}, achievements: [], lastSeen: Date.now() };
}

/**
 * Folds a profile a phone kept for itself back into the server's copy.
 *
 * Why this exists: on the free hosting tier the container's filesystem is thrown away, so
 * every cold start wiped every Career, achievement and Hall of Fame row. Rather than take
 * on a database for a party app, each phone keeps its own profile and re-uploads it on
 * join — the server's store becomes a cache that heals itself as people reconnect.
 *
 * The merge is deliberately **monotonic**: max on every counter, union on achievements,
 * and the more recently-seen record wins the display name. That makes it commutative and
 * idempotent, so it doesn't matter what order phones reconnect in, re-sending the same
 * profile changes nothing, and — importantly — a phone carrying a stale copy can never
 * roll back a newer server-side record. It only ever contributes what the server is
 * missing. (This is also why nothing here trusts the phone as authoritative: during a live
 * session the server still owns the writes via recordGameResult.)
 */
export function mergeProfiles(server: PlayerProfile | undefined, incoming: PlayerProfile): PlayerProfile {
  if (!server) return { ...incoming, playCounts: { ...incoming.playCounts }, winsByGame: { ...incoming.winsByGame }, achievements: [...incoming.achievements] };

  const maxByGame = (a: Partial<Record<GameId, number>>, b: Partial<Record<GameId, number>>): Partial<Record<GameId, number>> => {
    const out: Partial<Record<GameId, number>> = { ...a };
    for (const [gameId, count] of Object.entries(b) as [GameId, number][]) {
      out[gameId] = Math.max(out[gameId] ?? 0, count);
    }
    return out;
  };

  return {
    deviceId: server.deviceId,
    name: incoming.lastSeen > server.lastSeen ? incoming.name : server.name,
    gamesPlayed: Math.max(server.gamesPlayed, incoming.gamesPlayed),
    wins: Math.max(server.wins, incoming.wins),
    playCounts: maxByGame(server.playCounts, incoming.playCounts),
    winsByGame: maxByGame(server.winsByGame, incoming.winsByGame),
    achievements: [...new Set([...server.achievements, ...incoming.achievements])],
    lastSeen: Math.max(server.lastSeen, incoming.lastSeen),
  };
}

/** Called when a phone offers its own stored profile on join. Returns the merged result for the phone to save back, so both sides converge. */
export function restoreProfile(incoming: PlayerProfile): PlayerProfile {
  const store = load();
  const merged = mergeProfiles(store[incoming.deviceId], incoming);
  store[incoming.deviceId] = merged;
  persist();
  return merged;
}

/** Creates a profile on first contact, or just refreshes name/lastSeen on an existing one — called on every player:join, whether or not they ever finish a game. */
export function ensureProfile(deviceId: string, name: string): PlayerProfile {
  const store = load();
  const existing = store[deviceId];
  if (existing) {
    existing.name = name;
    existing.lastSeen = Date.now();
  } else {
    store[deviceId] = blankProfile(deviceId, name);
  }
  persist();
  return store[deviceId];
}

export function getProfile(deviceId: string): PlayerProfile | undefined {
  return load()[deviceId];
}

/** Records one game's result for a device and returns any achievement ids newly unlocked by it (empty if none). */
export function recordGameResult(deviceId: string, gameId: GameId, rank: number): string[] {
  const store = load();
  const profile = store[deviceId] ?? blankProfile(deviceId, "Player");
  store[deviceId] = profile;

  profile.gamesPlayed += 1;
  profile.playCounts[gameId] = (profile.playCounts[gameId] ?? 0) + 1;
  if (rank === 1) {
    profile.wins += 1;
    profile.winsByGame[gameId] = (profile.winsByGame[gameId] ?? 0) + 1;
  }
  profile.lastSeen = Date.now();

  const newlyUnlocked: string[] = [];
  for (const achievement of ACHIEVEMENTS) {
    if (profile.achievements.includes(achievement.id)) continue;
    if (achievement.check(profile)) {
      profile.achievements.push(achievement.id);
      newlyUnlocked.push(achievement.id);
    }
  }

  persist();
  return newlyUnlocked;
}

export interface HallOfFameEntry {
  name: string;
  wins: number;
  gamesPlayed: number;
  achievementCount: number;
}

/**
 * A pure read over the existing store — every device that's ever played already has a
 * profile here, this just ranks them.
 *
 * Grouped by name rather than by device. Storage is keyed by deviceId, but the board is
 * something a room reads out loud, and one person routinely holds several device ids: the
 * id lives in per-origin localStorage, so playing on the LAN address and playing on the
 * public URL already produce two, and clearing site data produces another. Listing those
 * as separate rivals is just wrong. Same monotonic spirit as mergeProfiles — sum the
 * games, union the achievements.
 */
export function getHallOfFame(limit = 20): HallOfFameEntry[] {
  const store = load();
  const byName = new Map<string, { name: string; wins: number; gamesPlayed: number; achievements: Set<string> }>();

  for (const profile of Object.values(store)) {
    if (profile.gamesPlayed <= 0) continue; // joined but never finished a game — nothing to rank
    const key = profile.name.trim().toLowerCase();
    const row = byName.get(key);
    if (row) {
      row.wins += profile.wins;
      row.gamesPlayed += profile.gamesPlayed;
      for (const id of profile.achievements) row.achievements.add(id);
    } else {
      byName.set(key, { name: profile.name, wins: profile.wins, gamesPlayed: profile.gamesPlayed, achievements: new Set(profile.achievements) });
    }
  }

  return [...byName.values()]
    .map((r) => ({ name: r.name, wins: r.wins, gamesPlayed: r.gamesPlayed, achievementCount: r.achievements.size }))
    .sort((a, b) => b.wins - a.wins || b.achievementCount - a.achievementCount)
    .slice(0, limit);
}
