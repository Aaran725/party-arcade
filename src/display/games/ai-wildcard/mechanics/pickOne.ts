import type { DisplayMechanicHandler } from "./types";
import { POINTS_BY_RANK } from "./shared";

/** Players pick one of N (2-4) AI-provided options — a herd-mentality mini-game: whoever
 * matches the room's most-picked option scores. (The old would-you-rather tallied by
 * option string and tried to hand points to "the option" as if it were a player, which
 * never actually paid out to a real chooser. This mechanic pays the choosers directly.) */
export function createPickOneMechanic(): DisplayMechanicHandler {
  const picks = new Map<string, string>(); // playerId -> chosen option (buttonId)

  return {
    label: "PICK ONE ON YOUR PHONE",
    reset: () => picks.clear(),
    hasAnswered: (playerId) => picks.has(playerId),
    handleInput: (playerId, msg) => {
      if (msg.type !== "input:button" || !msg.pressed) return;
      picks.set(playerId, msg.buttonId);
    },
    resolve: () => {
      const optionCounts = new Map<string, number>();
      for (const choice of picks.values()) optionCounts.set(choice, (optionCounts.get(choice) ?? 0) + 1);
      let bestOption: string | null = null;
      let bestCount = -1;
      for (const [option, count] of optionCounts) {
        if (count > bestCount) { bestCount = count; bestOption = option; }
      }
      return [...picks.entries()].map(([playerId, choice]) => {
        const isWinner = choice === bestOption;
        return { playerId, tally: optionCounts.get(choice) ?? 0, rank: isWinner ? 1 : 2, points: isWinner ? POINTS_BY_RANK[0] : 0 };
      });
    },
    onPlayerLeave: (playerId) => picks.delete(playerId),
  };
}
