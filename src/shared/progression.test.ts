import { describe, expect, it } from "vitest";
import { levelForXp, xpForGame, xpForNextLevel } from "./progression";

describe("xpForGame", () => {
  it("awards the rank bonus plus participation for a win", () => {
    expect(xpForGame(1)).toBe(10 + 25);
  });

  it("still awards participation XP for finishing outside the bonus ranks", () => {
    expect(xpForGame(4)).toBe(10);
    expect(xpForGame(8)).toBe(10);
  });

  it("awards the correct bonus for 2nd and 3rd", () => {
    expect(xpForGame(2)).toBe(10 + 15);
    expect(xpForGame(3)).toBe(10 + 8);
  });
});

describe("levelForXp", () => {
  it("starts at level 1 with zero xp", () => {
    expect(levelForXp(0)).toBe(1);
  });

  it("stays at level 1 right up to the threshold", () => {
    expect(levelForXp(99)).toBe(1);
  });

  it("advances exactly at a 100-xp boundary", () => {
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(200)).toBe(3);
  });

  it("never goes below level 1 for negative input", () => {
    // Shouldn't happen in practice (xp only ever grows), but the formula must not divide
    // into a negative level if it ever does.
    expect(levelForXp(-50)).toBe(1);
  });
});

describe("xpForNextLevel", () => {
  it("reports progress within the current level", () => {
    expect(xpForNextLevel(150)).toEqual({ current: 50, needed: 100 });
  });

  it("resets to zero right at a level boundary", () => {
    expect(xpForNextLevel(200)).toEqual({ current: 0, needed: 100 });
  });

  it("agrees with levelForXp about where boundaries fall", () => {
    for (const xp of [0, 99, 100, 250, 999]) {
      const levelBefore = levelForXp(xp);
      const { current } = xpForNextLevel(xp);
      expect(levelForXp(xp - current)).toBe(levelBefore); // stepping back to the start of the level shouldn't change it
    }
  });
});
