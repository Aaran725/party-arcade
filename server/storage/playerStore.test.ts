import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PlayerProfile } from "./playerStore";
import { getHallOfFame, getProfile, mergeProfiles, recordGameResult, resetStoreCacheForTests, restoreProfile } from "./playerStore";

function profile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    deviceId: "device-a",
    name: "Aaran",
    gamesPlayed: 0,
    wins: 0,
    playCounts: {},
    winsByGame: {},
    achievements: [],
    lastSeen: 1000,
    xp: 0,
    currentStreak: 0,
    longestStreak: 0,
    ...over,
  };
}

beforeEach(() => {
  // Each test gets its own throwaway data dir — the store is a process-lifetime cache in
  // production, so tests must reset both it and the file behind it.
  process.env.PARTY_ARCADE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "party-arcade-test-"));
  resetStoreCacheForTests();
});

describe("mergeProfiles", () => {
  it("adopts an incoming profile wholesale when the server has none (the cold-start case)", () => {
    const incoming = profile({ gamesPlayed: 12, wins: 4, achievements: ["first-win"] });
    expect(mergeProfiles(undefined, incoming)).toMatchObject({ gamesPlayed: 12, wins: 4, achievements: ["first-win"] });
  });

  it("does not alias the incoming profile's nested objects", () => {
    const incoming = profile({ achievements: ["first-win"], playCounts: { "hot-potato": 1 } });
    const merged = mergeProfiles(undefined, incoming);
    merged.achievements.push("veteran");
    merged.playCounts["tilt-maze"] = 9;
    expect(incoming.achievements).toEqual(["first-win"]);
    expect(incoming.playCounts).toEqual({ "hot-potato": 1 });
  });

  it("takes the max of every counter", () => {
    const server = profile({ gamesPlayed: 10, wins: 5, playCounts: { "hot-potato": 4 }, winsByGame: { "hot-potato": 2 } });
    const incoming = profile({ gamesPlayed: 7, wins: 6, playCounts: { "hot-potato": 1, "tilt-maze": 3 }, winsByGame: { "tilt-maze": 1 } });
    expect(mergeProfiles(server, incoming)).toMatchObject({
      gamesPlayed: 10,
      wins: 6,
      playCounts: { "hot-potato": 4, "tilt-maze": 3 },
      winsByGame: { "hot-potato": 2, "tilt-maze": 1 },
    });
  });

  it("unions achievements without duplicating them", () => {
    const server = profile({ achievements: ["first-win", "veteran"] });
    const incoming = profile({ achievements: ["veteran", "hat-trick"] });
    expect(mergeProfiles(server, incoming).achievements.sort()).toEqual(["first-win", "hat-trick", "veteran"]);
  });

  it("lets the more recently seen record win the display name", () => {
    const server = profile({ name: "Old", lastSeen: 1000 });
    expect(mergeProfiles(server, profile({ name: "New", lastSeen: 2000 })).name).toBe("New");
    expect(mergeProfiles(server, profile({ name: "Older", lastSeen: 500 })).name).toBe("Old");
  });

  it("is idempotent — re-merging the same profile changes nothing", () => {
    const server = profile({ gamesPlayed: 10, wins: 5, achievements: ["first-win"] });
    const incoming = profile({ gamesPlayed: 3, wins: 1, achievements: ["veteran"] });
    const once = mergeProfiles(server, incoming);
    expect(mergeProfiles(once, incoming)).toEqual(once);
  });

  it("is commutative — reconnection order cannot change the result", () => {
    const a = profile({ gamesPlayed: 9, wins: 2, achievements: ["first-win"], playCounts: { "draw-off": 4 }, lastSeen: 2000, name: "A" });
    const b = profile({ gamesPlayed: 4, wins: 6, achievements: ["veteran"], playCounts: { "tilt-maze": 2 }, lastSeen: 1000, name: "B" });
    const ab = mergeProfiles(a, b);
    const ba = mergeProfiles(b, a);
    expect({ ...ab, achievements: [...ab.achievements].sort() }).toEqual({ ...ba, achievements: [...ba.achievements].sort() });
  });

  it("a stale phone cannot roll back a newer server record", () => {
    // The whole safety argument for trusting phones at all.
    const server = profile({ gamesPlayed: 50, wins: 20, achievements: ["first-win", "veteran"], lastSeen: 9000 });
    const stale = profile({ gamesPlayed: 2, wins: 0, achievements: [], lastSeen: 10 });
    expect(mergeProfiles(server, stale)).toMatchObject({ gamesPlayed: 50, wins: 20, name: "Aaran" });
    expect(mergeProfiles(server, stale).achievements.sort()).toEqual(["first-win", "veteran"]);
  });

  it("takes the max of xp and longestStreak, same as the other counters", () => {
    const server = profile({ xp: 340, longestStreak: 2 });
    const incoming = profile({ xp: 120, longestStreak: 5 });
    expect(mergeProfiles(server, incoming)).toMatchObject({ xp: 340, longestStreak: 5 });
  });

  // currentStreak is the one field that CANNOT take max() — this is the actual reason it
  // needed a different rule from everything else in this file.
  describe("currentStreak (the non-monotonic field)", () => {
    it("does not resurrect a stale phone's higher streak over a server value that has since correctly reset to 0", () => {
      // The exact scenario: this device won three in a row on some other phone, then lost
      // on THIS phone, resetting the server's streak to 0. This phone's own local copy —
      // saved before the win streak even started — still says 0 too, but is now stale
      // (older lastSeen) relative to the server's post-loss state.
      const server = profile({ currentStreak: 0, lastSeen: 5000 }); // freshly reset by a loss
      const staleWithHighStreak = profile({ currentStreak: 3, lastSeen: 1000 }); // an old snapshot from mid win-streak
      expect(mergeProfiles(server, staleWithHighStreak).currentStreak).toBe(0);
    });

    it("adopts the incoming value when it is genuinely the fresher record", () => {
      const server = profile({ currentStreak: 0, lastSeen: 1000 });
      const fresherIncoming = profile({ currentStreak: 4, lastSeen: 5000 });
      expect(mergeProfiles(server, fresherIncoming).currentStreak).toBe(4);
    });

    it("adopts wholesale on the cold-start case (no server record at all)", () => {
      expect(mergeProfiles(undefined, profile({ currentStreak: 3 })).currentStreak).toBe(3);
    });
  });
});

describe("restoreProfile", () => {
  it("reseeds a profile the server lost, and hands back the merged result", () => {
    const restored = restoreProfile(profile({ gamesPlayed: 8, wins: 3 }));
    expect(restored).toMatchObject({ gamesPlayed: 8, wins: 3 });
    // And it's now durable server-side, so the Hall of Fame can see it again.
    expect(getHallOfFame()).toEqual([{ name: "Aaran", wins: 3, gamesPlayed: 8, achievementCount: 0, xp: 0, longestStreak: 0 }]);
  });

  it("does not clobber progress the server made during this session", () => {
    recordGameResult("device-a", "hot-potato", 1);
    recordGameResult("device-a", "hot-potato", 1);
    const restored = restoreProfile(profile({ gamesPlayed: 1, wins: 0, lastSeen: 1 }));
    expect(restored.wins).toBe(2);
    expect(restored.gamesPlayed).toBe(2);
  });
});

describe("getHallOfFame", () => {
  it("groups one person's several devices into a single row", () => {
    // A real case, not hypothetical: deviceId lives in per-origin localStorage, so playing
    // on the LAN address and on the public URL already yields two ids for one person.
    restoreProfile(profile({ deviceId: "lan-device", name: "Aaran", gamesPlayed: 4, wins: 2, achievements: ["first-win"], xp: 40, longestStreak: 2 }));
    restoreProfile(profile({ deviceId: "web-device", name: "Aaran", gamesPlayed: 6, wins: 3, achievements: ["first-win", "veteran"], xp: 70, longestStreak: 5 }));

    const board = getHallOfFame();
    expect(board).toHaveLength(1);
    // xp sums across the group (same spirit as wins/gamesPlayed); longestStreak takes the
    // best of either device, not a sum — a streak isn't additive across two phones.
    expect(board[0]).toEqual({ name: "Aaran", wins: 5, gamesPlayed: 10, achievementCount: 2, xp: 110, longestStreak: 5 });
  });

  it("treats differently-cased spellings of a name as the same person", () => {
    restoreProfile(profile({ deviceId: "d1", name: "Sam", gamesPlayed: 2, wins: 1 }));
    restoreProfile(profile({ deviceId: "d2", name: "sam", gamesPlayed: 2, wins: 1 }));
    expect(getHallOfFame()).toHaveLength(1);
  });

  it("keeps genuinely different people apart, ranked by wins", () => {
    restoreProfile(profile({ deviceId: "d1", name: "Aaran", gamesPlayed: 5, wins: 1 }));
    restoreProfile(profile({ deviceId: "d2", name: "Sam", gamesPlayed: 5, wins: 4 }));
    expect(getHallOfFame().map((r) => r.name)).toEqual(["Sam", "Aaran"]);
  });

  it("omits devices that joined but never finished a game", () => {
    restoreProfile(profile({ deviceId: "d1", name: "Ghost", gamesPlayed: 0, wins: 0 }));
    expect(getHallOfFame()).toEqual([]);
  });
});

describe("recordGameResult", () => {
  it("awards participation XP even without a win", () => {
    recordGameResult("device-a", "hot-potato", 4);
    expect(getProfileXp()).toBe(10);
  });

  it("awards the rank bonus on top of participation for a win", () => {
    recordGameResult("device-a", "hot-potato", 1);
    expect(getProfileXp()).toBe(10 + 25);
  });

  it("increments currentStreak on a win and resets it on anything else", () => {
    recordGameResult("device-a", "hot-potato", 1);
    recordGameResult("device-a", "hot-potato", 1);
    expect(getProfileStreak()).toEqual({ currentStreak: 2, longestStreak: 2 });

    recordGameResult("device-a", "hot-potato", 2);
    expect(getProfileStreak()).toEqual({ currentStreak: 0, longestStreak: 2 }); // the high-water mark survives the reset
  });

  it("reports leveledUpTo only on the game that actually crosses the boundary", () => {
    // 10 participation xp/game — 10 games to reach the 100xp level-2 boundary exactly.
    for (let i = 0; i < 9; i++) {
      expect(recordGameResult("device-a", "hot-potato", 5).leveledUpTo).toBeNull();
    }
    expect(recordGameResult("device-a", "hot-potato", 5).leveledUpTo).toBe(2);
    expect(recordGameResult("device-a", "hot-potato", 5).leveledUpTo).toBeNull(); // level 2 already reached, no repeat
  });
});

function getProfileXp(): number {
  return getProfile("device-a")!.xp;
}
function getProfileStreak(): { currentStreak: number; longestStreak: number } {
  const p = getProfile("device-a")!;
  return { currentStreak: p.currentStreak, longestStreak: p.longestStreak };
}
