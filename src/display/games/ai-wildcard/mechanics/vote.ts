import type { DisplayMechanicHandler } from "./types";
import { rankByTally } from "./shared";

/** Players vote for ANOTHER player (e.g. "most likely to..."). Points go to whoever
 * RECEIVES the most votes, not to the voters — a popularity-contest shape, deliberately
 * different from pick-one's "did you match the room" shape below. */
export function createVoteMechanic(): DisplayMechanicHandler {
  const votes = new Map<string, string>(); // voterId -> target playerId

  return {
    label: "VOTE ON YOUR PHONE",
    reset: () => votes.clear(),
    hasAnswered: (playerId) => votes.has(playerId),
    handleInput: (playerId, msg) => {
      if (msg.type !== "input:button" || !msg.pressed) return;
      if (playerId === msg.buttonId) return; // defensive — client already excludes self
      votes.set(playerId, msg.buttonId);
    },
    resolve: () => {
      const counts = new Map<string, number>();
      for (const target of votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
      return rankByTally([...counts.entries()].map(([playerId, tally]) => ({ playerId, tally })));
    },
    onPlayerLeave: (playerId) => votes.delete(playerId),
  };
}
