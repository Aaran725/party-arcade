import { NUMBER_GUESS_RANGE } from "@shared/wildcardConfig";
import type { DisplayMechanicHandler } from "./types";
import { rankByDistance } from "./shared";

// The Display picks a secret target in [0, NUMBER_GUESS_RANGE] client-side (same precedent
// as aim's targetHeading) — never sent to controllers, or the "hidden number" premise breaks.

export function createNumberGuessMechanic(): DisplayMechanicHandler {
  const guesses = new Map<string, number>();

  return {
    label: "GUESS THE NUMBER ON YOUR PHONE",
    reset: () => guesses.clear(),
    hasAnswered: (playerId) => guesses.has(playerId),
    handleInput: (playerId, msg) => {
      if (msg.type !== "input:text") return;
      const n = Number(msg.text);
      if (!Number.isNaN(n)) guesses.set(playerId, n);
    },
    resolve: (_players, round) => {
      const target = round.secret ?? 0;
      const withDistance = [...guesses.entries()].map(([playerId, guess]) => ({ playerId, distance: Math.abs(guess - target) }));
      return rankByDistance(withDistance, (distance) => Math.max(0, NUMBER_GUESS_RANGE - distance));
    },
    onPlayerLeave: (playerId) => guesses.delete(playerId),
  };
}
