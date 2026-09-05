import fs from "node:fs";
import path from "node:path";
import type { GameId } from "@shared/types/room";
import { ACHIEVEMENTS, type PlayerStats } from "@shared/achievements";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "players.json");

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
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    cache = {}; // first run, or a corrupt/missing file — start fresh rather than crash the server
  }
  return cache!;
}

function persist(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
}

function blankProfile(deviceId: string, name: string): PlayerProfile {
  return { deviceId, name, gamesPlayed: 0, wins: 0, playCounts: {}, winsByGame: {}, achievements: [], lastSeen: Date.now() };
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

/** A pure read over the existing store — every device that's ever played already has a profile here, this just ranks them. No new tracking, just the first time anyone's been able to see anyone else's. */
export function getHallOfFame(limit = 20): HallOfFameEntry[] {
  const store = load();
  return Object.values(store)
    .filter((p) => p.gamesPlayed > 0) // a device that joined but never finished a game has nothing to rank
    .map((p) => ({ name: p.name, wins: p.wins, gamesPlayed: p.gamesPlayed, achievementCount: p.achievements.length }))
    .sort((a, b) => b.wins - a.wins || b.achievementCount - a.achievementCount)
    .slice(0, limit);
}
