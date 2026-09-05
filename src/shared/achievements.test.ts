import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, type PlayerStats } from "./achievements";
import { ALL_GAME_IDS, type GameId } from "./types/room";

function stats(over: Partial<PlayerStats> = {}): PlayerStats {
  return { gamesPlayed: 0, wins: 0, playCounts: {}, winsByGame: {}, ...over };
}

function check(id: string, s: PlayerStats): boolean {
  const achievement = ACHIEVEMENTS.find((a) => a.id === id);
  if (!achievement) throw new Error(`no achievement with id "${id}"`);
  return achievement.check(s);
}

describe("achievement predicates", () => {
  it("every achievement has a unique id", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no achievement unlocks on a brand-new profile", () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.check(stats()), `${achievement.id} unlocked on an empty profile`).toBe(false);
    }
  });

  it("first-win needs exactly one win", () => {
    expect(check("first-win", stats({ wins: 0 }))).toBe(false);
    expect(check("first-win", stats({ wins: 1 }))).toBe(true);
  });

  it("veteran needs 10 games", () => {
    expect(check("veteran", stats({ gamesPlayed: 9 }))).toBe(false);
    expect(check("veteran", stats({ gamesPlayed: 10 }))).toBe(true);
  });

  it("champion needs a Push Battle win specifically", () => {
    expect(check("champion", stats({ winsByGame: { "hot-potato": 5 } }))).toBe(false);
    expect(check("champion", stats({ winsByGame: { "push-battle": 1 } }))).toBe(true);
  });

  it("hat-trick needs three wins in the *same* game, not three wins overall", () => {
    expect(check("hat-trick", stats({ winsByGame: { "hot-potato": 2, "tilt-maze": 2 } }))).toBe(false);
    expect(check("hat-trick", stats({ winsByGame: { "hot-potato": 3 } }))).toBe(true);
  });

  describe("well-rounded", () => {
    function playCountsFor(ids: readonly GameId[]): Partial<Record<GameId, number>> {
      return Object.fromEntries(ids.map((id) => [id, 1]));
    }

    it("unlocks once every game in the registry has been played", () => {
      expect(check("well-rounded", stats({ playCounts: playCountsFor(ALL_GAME_IDS) }))).toBe(true);
    });

    it("does NOT unlock one game short of the full roster", () => {
      // Regression guard: the threshold used to be a hand-maintained constant that drifted
      // behind the roster, so "play every game" unlocked while a game was still unplayed.
      const allButOne = ALL_GAME_IDS.slice(0, -1);
      expect(check("well-rounded", stats({ playCounts: playCountsFor(allButOne) }))).toBe(false);
    });
  });
});
