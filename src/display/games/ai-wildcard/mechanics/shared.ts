import type { RankedResult } from "./types";

export const POINTS_BY_RANK = [25, 15, 8];

export function rankByTally(counts: { playerId: string; tally: number }[]): RankedResult[] {
  const sorted = [...counts].sort((a, b) => b.tally - a.tally);
  const results: RankedResult[] = [];
  let rank = 0;
  let prev: number | null = null;
  sorted.forEach((r, i) => {
    if (prev === null || r.tally !== prev) rank = i + 1;
    prev = r.tally;
    results.push({ playerId: r.playerId, tally: r.tally, rank, points: POINTS_BY_RANK[rank - 1] ?? 0 });
  });
  return results;
}

export function rankByDistance(entries: { playerId: string; distance: number }[], tallyFromDistance: (distance: number) => number): RankedResult[] {
  const sorted = [...entries].sort((a, b) => a.distance - b.distance);
  let rank = 0;
  let prevDistance: number | null = null;
  return sorted.map((r, i) => {
    if (prevDistance === null || r.distance !== prevDistance) rank = i + 1;
    prevDistance = r.distance;
    return { playerId: r.playerId, tally: tallyFromDistance(r.distance), rank, points: POINTS_BY_RANK[rank - 1] ?? 0 };
  });
}
