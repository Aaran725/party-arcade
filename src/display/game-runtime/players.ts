import type { PlayerInfo } from "@shared/types/room";

/**
 * The roster minus anyone who has dropped — every timed game needs this, and ten of them
 * had a byte-identical private copy. Games keep owning their own `connectedIds` set (they
 * mutate it from `onPlayerLeave`); this is just the filter.
 */
export function connectedPlayers(all: PlayerInfo[], connectedIds: ReadonlySet<string>): PlayerInfo[] {
  return all.filter((p) => connectedIds.has(p.id));
}
