import { describe, expect, it } from "vitest";
import type { GameId, GameMeta } from "@shared/types/room";
import { isCloseCall, pickNextGameAutopilot, type EnergySignals } from "./autopilot";

function meta(id: string, pace: GameMeta["pace"]): GameMeta {
  return {
    id: id as GameId,
    title: id,
    description: "",
    minPlayers: 2,
    maxPlayers: 8,
    requiresMotion: false,
    requiresPointer: false,
    pace,
  };
}

function signals(over: Partial<EnergySignals> = {}): EnergySignals {
  return {
    reactionsSinceLastGame: 0,
    achievementsSinceLastGame: 0,
    lastGameWasCloseCall: false,
    playedThisParty: new Set<GameId>(),
    ...over,
  };
}

describe("isCloseCall", () => {
  it("is true for a small absolute gap", () => {
    expect(isCloseCall({ a: 8, b: 5 })).toBe(true);
  });

  it("is true for a small relative gap in a high-scoring game", () => {
    // 10 apart, but that's under 15% of 100 — Reaction Buzzer combo territory.
    expect(isCloseCall({ a: 100, b: 90 })).toBe(true);
  });

  it("is false for a blowout", () => {
    expect(isCloseCall({ a: 100, b: 20 })).toBe(false);
  });

  it("is false for a 0-0 tie — a dud round, not a nail-biter", () => {
    // Regression guard: gap is technically 0 here, which read as 'closest possible call'
    // until the ranked[0] <= 0 check was added.
    expect(isCloseCall({ a: 0, b: 0 })).toBe(false);
  });

  it("is false with fewer than two players", () => {
    expect(isCloseCall({ a: 10 })).toBe(false);
    expect(isCloseCall({})).toBe(false);
  });

  it("ignores everyone below the top two", () => {
    expect(isCloseCall({ a: 10, b: 9, c: 0 })).toBe(true);
  });
});

describe("pickNextGameAutopilot", () => {
  const pool = [meta("fast-1", "fast"), meta("medium-1", "medium"), meta("slow-1", "slow")];

  it("reaches for a fast game when the room has gone quiet", () => {
    const { meta: picked, reason } = pickNextGameAutopilot(pool, signals());
    expect(picked.pace).toBe("fast");
    expect(reason).toMatch(/speed things up/);
  });

  it("earns a change of pace when reactions are flowing", () => {
    const { meta: picked, reason } = pickNextGameAutopilot(pool, signals({ reactionsSinceLastGame: 6 }));
    expect(picked.pace).toBe("slow");
    expect(reason).toMatch(/change of pace/);
  });

  it("treats a close call alone as high energy", () => {
    expect(pickNextGameAutopilot(pool, signals({ lastGameWasCloseCall: true })).meta.pace).toBe("slow");
  });

  it("treats a fresh achievement alone as high energy", () => {
    expect(pickNextGameAutopilot(pool, signals({ achievementsSinceLastGame: 1 })).meta.pace).toBe("slow");
  });

  it("falls through to medium when energy is neither low nor high", () => {
    // Two reactions clears the low bar but not the 6-reaction high bar, and nothing else
    // signals high energy — the in-between case.
    const { meta: picked, reason } = pickNextGameAutopilot(pool, signals({ reactionsSinceLastGame: 2 }));
    expect(picked.pace).toBe("medium");
    expect(reason).toMatch(/varied/);
  });

  it("never repeats a played game while an unplayed one remains", () => {
    const played = new Set<GameId>(["fast-1" as GameId]);
    const picked = pickNextGameAutopilot(pool, signals({ playedThisParty: played })).meta;
    expect(picked.id).not.toBe("fast-1");
  });

  it("allows repeats once everything has been played, rather than failing", () => {
    const played = new Set<GameId>(pool.map((g) => g.id));
    const picked = pickNextGameAutopilot(pool, signals({ playedThisParty: played })).meta;
    expect(pool.map((g) => g.id)).toContain(picked.id);
  });

  it("still returns a game when the desired pace is unavailable", () => {
    // Low energy wants `fast`, but there's none left — must fall through, not return undefined.
    const noFast = [meta("slow-1", "slow")];
    expect(pickNextGameAutopilot(noFast, signals()).meta.id).toBe("slow-1");
  });
});
