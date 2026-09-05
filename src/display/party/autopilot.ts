import type { GameId, GameMeta } from "@shared/types/room";

export interface EnergySignals {
  /** Reaction taps since the last game ended — the room's own applause meter. */
  reactionsSinceLastGame: number;
  /** Achievements unlocked since the last game ended. */
  achievementsSinceLastGame: number;
  /** True when the last game's top two scores were close — a real nail-biter keeps energy up on its own. */
  lastGameWasCloseCall: boolean;
  /** Games already played this party — never repeat while there's still an unplayed option. */
  playedThisParty: Set<GameId>;
}

const LOW_ENERGY_REACTION_THRESHOLD = 2;

/** A round counts as a "close call" if the top two scores are within 5 points, or within 15% of the winner's score — an absolute-plus-relative rule so it works whether a game scores in single digits (Hot Potato) or the hundreds (Reaction Buzzer combos). Requires an actual winning score above 0 — a 0-0 tie (a round force-ended before anyone did anything) is a dud, not a nail-biter, even though its gap is technically zero. */
export function isCloseCall(scores: Record<string, number>): boolean {
  const ranked = Object.values(scores).sort((a, b) => b - a);
  if (ranked.length < 2 || ranked[0] <= 0) return false;
  const gap = ranked[0] - ranked[1];
  return gap <= 5 || gap <= ranked[0] * 0.15;
}

/**
 * The Autopilot Party Director's one real decision, made fresh each round instead of
 * reading a pre-shuffled queue (src/display/Router.ts's advanceParty()). A transparent,
 * fast, free heuristic — not an LLM call — because this fires every single round and needs
 * an answer the AI Leader can explain out loud immediately, not a 1-2s round trip.
 *
 * The logic: low energy (few reactions, no new achievements, a blowout finish) means the
 * room needs a jolt — reach for a `fast`-paced game to re-energize it. High energy means
 * the room can absorb a change of pace — a `slow` deduction/drawing game reads as a
 * deliberate, earned breather rather than a lull. Anything in between just picks the most
 * varied option (least-recently-represented pace) to avoid two same-pace games in a row.
 */
export function pickNextGameAutopilot(remainingPool: GameMeta[], signals: EnergySignals): { meta: GameMeta; reason: string } {
  const unplayed = remainingPool.filter((g) => !signals.playedThisParty.has(g.id));
  const pool = unplayed.length > 0 ? unplayed : remainingPool; // everything's been played — repeats are fine, just keep going

  const energyIsLow =
    signals.reactionsSinceLastGame < LOW_ENERGY_REACTION_THRESHOLD && signals.achievementsSinceLastGame === 0 && !signals.lastGameWasCloseCall;

  if (energyIsLow) {
    const fast = pool.filter((g) => g.pace === "fast");
    if (fast.length > 0) {
      const meta = fast[Math.floor(Math.random() * fast.length)];
      return { meta, reason: "the room's gone quiet — time to speed things up" };
    }
  }

  const energyIsHigh = signals.reactionsSinceLastGame >= LOW_ENERGY_REACTION_THRESHOLD * 3 || signals.achievementsSinceLastGame > 0 || signals.lastGameWasCloseCall;

  if (energyIsHigh) {
    const slow = pool.filter((g) => g.pace === "slow");
    if (slow.length > 0) {
      const meta = slow[Math.floor(Math.random() * slow.length)];
      return { meta, reason: "the energy's high enough to earn a change of pace" };
    }
  }

  const medium = pool.filter((g) => g.pace === "medium");
  const meta = (medium.length > 0 ? medium : pool)[Math.floor(Math.random() * (medium.length > 0 ? medium.length : pool.length))];
  return { meta, reason: "keeping things varied" };
}
