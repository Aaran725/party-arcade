import { describe, expect, it } from "vitest";
import type { GameId } from "@shared/types/room";
import type { PartyHistoryEntry } from "./PartySession";
import { biggestBlowoutEntry, closestMomentEntry, partyMvp, winnerOf } from "./superlatives";

function entry(gameId: GameId, scores: Record<string, number>): PartyHistoryEntry {
  return { gameId, scores };
}

describe("winnerOf", () => {
  it("returns the highest scorer", () => {
    expect(winnerOf({ a: 3, b: 9, c: 5 })).toBe("b");
  });

  it("returns null for an empty scores map rather than throwing", () => {
    expect(winnerOf({})).toBeNull();
  });

  it("still names a winner when everyone scored zero", () => {
    // A dud round still has to attribute *someone* — the recap has no 'nobody won' card.
    expect(winnerOf({ a: 0, b: 0 })).toBe("a");
  });

  it("handles negative scores (Fruit Slice docks points for bombs)", () => {
    expect(winnerOf({ a: -5, b: -1 })).toBe("b");
  });
});

describe("closestMomentEntry", () => {
  it("picks the game with the smallest top-two gap", () => {
    const history = [entry("hot-potato", { a: 10, b: 2 }), entry("draw-off", { a: 7, b: 6 }), entry("tilt-maze", { a: 9, b: 4 })];
    expect(closestMomentEntry(history)?.gameId).toBe("draw-off");
  });

  it("skips single-player games, which have no gap to measure", () => {
    const history = [entry("hot-potato", { a: 5 }), entry("draw-off", { a: 8, b: 1 })];
    expect(closestMomentEntry(history)?.gameId).toBe("draw-off");
  });

  it("returns null when no game had two or more players", () => {
    expect(closestMomentEntry([entry("hot-potato", { a: 5 })])).toBeNull();
  });

  it("returns null for empty history", () => {
    expect(closestMomentEntry([])).toBeNull();
  });

  it("keeps the first game on a tie, so the recap is stable across renders", () => {
    const history = [entry("hot-potato", { a: 5, b: 4 }), entry("draw-off", { a: 9, b: 8 })];
    expect(closestMomentEntry(history)?.gameId).toBe("hot-potato");
  });
});

describe("biggestBlowoutEntry", () => {
  it("picks the game with the largest top-two gap", () => {
    const history = [entry("hot-potato", { a: 10, b: 2 }), entry("draw-off", { a: 7, b: 6 }), entry("tilt-maze", { a: 30, b: 1 })];
    expect(biggestBlowoutEntry(history)?.gameId).toBe("tilt-maze");
  });

  it("returns null for empty history", () => {
    expect(biggestBlowoutEntry([])).toBeNull();
  });

  it("still returns a game when every gap is zero", () => {
    // largestGap starts at -1 specifically so a perfectly tied game still qualifies.
    expect(biggestBlowoutEntry([entry("hot-potato", { a: 3, b: 3 })])?.gameId).toBe("hot-potato");
  });
});

describe("partyMvp", () => {
  it("is the top of the final standings", () => {
    expect(partyMvp({ a: 12, b: 40, c: 39 })).toBe("b");
  });

  it("returns null when nobody has standings", () => {
    expect(partyMvp({})).toBeNull();
  });
});
