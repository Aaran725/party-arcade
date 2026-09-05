import type { DisplayMechanicHandler } from "./types";

// "type" has no cheap way to judge answer quality without another AI call — everyone who
// answers gets the same participation credit.
const TYPE_PARTICIPATION_POINTS = 10;

export function createTypeMechanic(): DisplayMechanicHandler {
  const responses = new Map<string, string>();

  return {
    label: "TYPE ON YOUR PHONE",
    reset: () => responses.clear(),
    hasAnswered: (playerId) => responses.has(playerId),
    handleInput: (playerId, msg) => {
      if (msg.type !== "input:text") return;
      responses.set(playerId, msg.text.slice(0, 140));
    },
    resolve: () => [...responses.keys()].map((playerId) => ({ playerId, tally: 1, rank: 1, points: TYPE_PARTICIPATION_POINTS })),
    onPlayerLeave: (playerId) => responses.delete(playerId),
  };
}
