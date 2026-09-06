import fs from "node:fs";
import path from "node:path";
import type { GameId } from "@shared/types/room";
import { ACHIEVEMENTS, type PlayerStats } from "@shared/achievements";
import { levelForXp, xpForGame } from "@shared/progression";

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
  /** Cumulative career total. Level is never stored — always `levelForXp(xp)` (src/shared/progression.ts), so there's no second copy of the number that could disagree with it. */
  xp: number;
  /** Consecutive 1st-place finishes, reset to 0 by anything else. Unlike every other field here, this is NOT monotonic — see mergeProfiles below. */
  currentStreak: number;
  /** The high-water mark of currentStreak. Monotonic, same as wins/gamesPlayed. */
  longestStreak: number;
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
  // Rows written before xp/currentStreak/longestStreak existed come back from JSON.parse
  // without them — there's no schema version to migrate on, so every profile is normalized
  // exactly once here, the moment it enters memory, rather than scattering `?? 0` at every
  // call site that happens to read one of these fields.
  for (const profile of Object.values(cache!)) {
    profile.xp ??= 0;
    profile.currentStreak ??= 0;
    profile.longestStreak ??= 0;
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
  return { deviceId, name, gamesPlayed: 0, wins: 0, playCounts: {}, winsByGame: {}, achievements: [], lastSeen: Date.now(), xp: 0, currentStreak: 0, longestStreak: 0 };
}

/** Profiles written before this field existed come back from JSON.parse without it — there's no schema version to migrate on, so every read of a progression field goes through this rather than trusting the type. */
function xpOf(p: PlayerProfile): number {
  return p.xp ?? 0;
}
function currentStreakOf(p: PlayerProfile): number {
  return p.currentStreak ?? 0;
}
function longestStreakOf(p: PlayerProfile): number {
  return p.longestStreak ?? 0;
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
  if (!server) {
    return {
      ...incoming,
      playCounts: { ...incoming.playCounts },
      winsByGame: { ...incoming.winsByGame },
      achievements: [...incoming.achievements],
      xp: xpOf(incoming),
      currentStreak: currentStreakOf(incoming),
      longestStreak: longestStreakOf(incoming),
    };
  }

  const maxByGame = (a: Partial<Record<GameId, number>>, b: Partial<Record<GameId, number>>): Partial<Record<GameId, number>> => {
    const out: Partial<Record<GameId, number>> = { ...a };
    for (const [gameId, count] of Object.entries(b) as [GameId, number][]) {
      out[gameId] = Math.max(out[gameId] ?? 0, count);
    }
    return out;
  };

  // Whichever side was more recently active — same LWW-by-lastSeen rule `name` already
  // uses just below. currentStreak is the one field here that genuinely can't take max():
  // a reset to 0 is a real, correct value, and max() would let a stale phone's old high
  // streak resurrect itself over a server value that has since correctly reset.
  const incomingIsFresher = incoming.lastSeen > server.lastSeen;

  return {
    deviceId: server.deviceId,
    name: incomingIsFresher ? incoming.name : server.name,
    gamesPlayed: Math.max(server.gamesPlayed, incoming.gamesPlayed),
    wins: Math.max(server.wins, incoming.wins),
    playCounts: maxByGame(server.playCounts, incoming.playCounts),
    winsByGame: maxByGame(server.winsByGame, incoming.winsByGame),
    achievements: [...new Set([...server.achievements, ...incoming.achievements])],
    lastSeen: Math.max(server.lastSeen, incoming.lastSeen),
    xp: Math.max(xpOf(server), xpOf(incoming)),
    currentStreak: incomingIsFresher ? currentStreakOf(incoming) : currentStreakOf(server),
    longestStreak: Math.max(longestStreakOf(server), longestStreakOf(incoming)),
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

/** The wire shape both the join and game:over paths send down as player:profile_sync — pulled out once so the two call sites in handlers.ts can't drift apart on which fields they include. */
export function toStoredProfileSnapshot(profile: PlayerProfile) {
  return {
    gamesPlayed: profile.gamesPlayed,
    wins: profile.wins,
    playCounts: profile.playCounts,
    winsByGame: profile.winsByGame,
    achievements: profile.achievements,
    lastSeen: profile.lastSeen,
    xp: profile.xp,
    currentStreak: profile.currentStreak,
    longestStreak: profile.longestStreak,
  };
}

export interface GameResultOutcome {
  newlyUnlockedAchievements: string[];
  /** The new level, only set the frame a game award actually crossed a 100-xp boundary. */
  leveledUpTo: number | null;
}

/** Records one game's result for a device: games/wins/XP/streak, plus any achievements newly unlocked by it. */
export function recordGameResult(deviceId: string, gameId: GameId, rank: number): GameResultOutcome {
  const store = load();
  const profile = store[deviceId] ?? blankProfile(deviceId, "Player");
  store[deviceId] = profile;
  // load() already normalizes xp/currentStreak/longestStreak on every profile already in
  // the store; blankProfile() does the same for a brand-new one. Either way the arithmetic
  // below never adds onto `undefined`.

  profile.gamesPlayed += 1;
  profile.playCounts[gameId] = (profile.playCounts[gameId] ?? 0) + 1;
  if (rank === 1) {
    profile.wins += 1;
    profile.winsByGame[gameId] = (profile.winsByGame[gameId] ?? 0) + 1;
    profile.currentStreak += 1;
    profile.longestStreak = Math.max(profile.longestStreak, profile.currentStreak);
  } else {
    profile.currentStreak = 0;
  }
  profile.lastSeen = Date.now();

  const levelBefore = levelForXp(profile.xp);
  profile.xp += xpForGame(rank);
  const levelAfter = levelForXp(profile.xp);

  const newlyUnlockedAchievements: string[] = [];
  for (const achievement of ACHIEVEMENTS) {
    if (profile.achievements.includes(achievement.id)) continue;
    if (achievement.check(profile)) {
      profile.achievements.push(achievement.id);
      newlyUnlockedAchievements.push(achievement.id);
    }
  }

  persist();
  return { newlyUnlockedAchievements, leveledUpTo: levelAfter > levelBefore ? levelAfter : null };
}

export interface HallOfFameEntry {
  name: string;
  wins: number;
  gamesPlayed: number;
  achievementCount: number;
  /** Summed across every device grouped under this name — same spirit as wins/gamesPlayed below. Level is derived client-side from this via levelForXp, never sent as its own number. */
  xp: number;
  /** The best streak this name has ever reached on ANY of its devices — a max across the group, same as longestStreak's own merge rule. */
  longestStreak: number;
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
  const byName = new Map<
    string,
    { name: string; wins: number; gamesPlayed: number; achievements: Set<string>; xp: number; longestStreak: number }
  >();

  for (const profile of Object.values(store)) {
    if (profile.gamesPlayed <= 0) continue; // joined but never finished a game — nothing to rank
    const key = profile.name.trim().toLowerCase();
    const row = byName.get(key);
    if (row) {
      row.wins += profile.wins;
      row.gamesPlayed += profile.gamesPlayed;
      row.xp += profile.xp;
      row.longestStreak = Math.max(row.longestStreak, profile.longestStreak);
      for (const id of profile.achievements) row.achievements.add(id);
    } else {
      byName.set(key, {
        name: profile.name,
        wins: profile.wins,
        gamesPlayed: profile.gamesPlayed,
        achievements: new Set(profile.achievements),
        xp: profile.xp,
        longestStreak: profile.longestStreak,
      });
    }
  }

  return [...byName.values()]
    .map((r) => ({ name: r.name, wins: r.wins, gamesPlayed: r.gamesPlayed, achievementCount: r.achievements.size, xp: r.xp, longestStreak: r.longestStreak }))
    .sort((a, b) => b.wins - a.wins || b.achievementCount - a.achievementCount)
    .slice(0, limit);
}
