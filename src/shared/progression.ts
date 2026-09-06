/**
 * The Career XP/level formula — one source of truth, imported by the server (to detect a
 * level-up when awarding XP) and both clients (to display one). Level is deliberately never
 * stored as its own field anywhere; it's always derived from `xp` so there's no second copy
 * of the number that could disagree with it.
 */

// Every game participation, win or not, is worth something — the whole point of this
// system is that a loss still feels like progress. The rank bonus reuses AI Wildcard's own
// POINTS_BY_RANK shape (src/display/games/ai-wildcard/mechanics/shared.ts) so the numbers
// feel consistent with a convention that already exists elsewhere in the app.
export const XP_PARTICIPATION = 10;
export const XP_RANK_BONUS = [25, 15, 8];

export function xpForGame(rank: number): number {
  return XP_PARTICIPATION + (XP_RANK_BONUS[rank - 1] ?? 0);
}

const XP_PER_LEVEL = 100;

export function levelForXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

/** How far into the current level `xp` sits, and how much the level needs in total — for a progress bar. */
export function xpForNextLevel(xp: number): { current: number; needed: number } {
  const clamped = Math.max(0, xp);
  return { current: clamped % XP_PER_LEVEL, needed: XP_PER_LEVEL };
}
