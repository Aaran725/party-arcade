import type { DisplayMechanicHandler } from "./types";
import { POINTS_BY_RANK } from "./shared";

export function createFastTapMechanic(): DisplayMechanicHandler {
  let tapOrder: string[] = [];

  return {
    label: "TAP FASTEST ON YOUR PHONE",
    reset: () => { tapOrder = []; },
    hasAnswered: (playerId) => tapOrder.includes(playerId),
    handleInput: (playerId, msg) => {
      if (msg.type !== "input:button" || !msg.pressed) return;
      if (!tapOrder.includes(playerId)) tapOrder.push(playerId);
    },
    resolve: () => tapOrder.map((playerId, i) => ({ playerId, tally: tapOrder.length - i, rank: i + 1, points: POINTS_BY_RANK[i] ?? 0 })),
    onPlayerLeave: (playerId) => { tapOrder = tapOrder.filter((id) => id !== playerId); },
  };
}
