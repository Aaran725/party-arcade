import type { PartyHistoryEntry } from "./PartySession";

/** The highest scorer in a single scores map — used both for one game's own winner and (with final standings) the whole party's MVP. */
export function winnerOf(scores: Record<string, number>): string | null {
  const entries = Object.entries(scores);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

/** The game in this party whose top-two scores were closest — a real nail-biter, not just "someone won." */
export function closestMomentEntry(history: PartyHistoryEntry[]): PartyHistoryEntry | null {
  let closest: PartyHistoryEntry | null = null;
  let smallestGap = Infinity;
  for (const entry of history) {
    const ranked = Object.values(entry.scores).sort((a, b) => b - a);
    if (ranked.length < 2) continue;
    const gap = ranked[0] - ranked[1];
    if (gap < smallestGap) {
      smallestGap = gap;
      closest = entry;
    }
  }
  return closest;
}

/** The game with the single largest gap between 1st and 2nd — the opposite of closestMomentEntry, a genuine blowout. */
export function biggestBlowoutEntry(history: PartyHistoryEntry[]): PartyHistoryEntry | null {
  let biggest: PartyHistoryEntry | null = null;
  let largestGap = -1;
  for (const entry of history) {
    const ranked = Object.values(entry.scores).sort((a, b) => b - a);
    if (ranked.length < 2) continue;
    const gap = ranked[0] - ranked[1];
    if (gap > largestGap) {
      largestGap = gap;
      biggest = entry;
    }
  }
  return biggest;
}

/** The party's overall MVP — highest final standings across every game played, same tie-break (first sorted) as winnerOf. */
export function partyMvp(standings: Record<string, number>): string | null {
  return winnerOf(standings);
}
