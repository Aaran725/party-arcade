import { describe, it, expect } from "vitest";
import { computeRanks } from "./handlers";

describe("computeRanks", () => {
  it("ranks players by score, highest first", () => {
    const ranks = computeRanks({ a: 30, b: 10, c: 20 });
    expect(ranks.get("a")).toBe(1);
    expect(ranks.get("c")).toBe(2);
    expect(ranks.get("b")).toBe(3);
  });

  it("shares a rank between tied scores and skips ahead for the next distinct score", () => {
    const ranks = computeRanks({ a: 30, b: 30, c: 10 });
    expect(ranks.get("a")).toBe(1);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(3); // two players already claimed ranks 1 and 2
  });

  it("returns an empty map for no scores", () => {
    expect(computeRanks({}).size).toBe(0);
  });

  it("ranks a single player first", () => {
    expect(computeRanks({ solo: 0 }).get("solo")).toBe(1);
  });
});
