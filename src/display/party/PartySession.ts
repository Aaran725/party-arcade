import type { GameId, GameMeta } from "@shared/types/room";

export function eligibleGames(games: GameMeta[], playerCount: number): GameMeta[] {
  return games.filter((g) => playerCount >= g.minPlayers && playerCount <= g.maxPlayers);
}

/** Fisher-Yates shuffle — pure, does not mutate the input. */
export function buildPartyQueue(selectedIds: GameId[]): GameId[] {
  const queue = [...selectedIds];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}

export interface PartyHistoryEntry {
  gameId: GameId;
  scores: Record<string, number>;
  /** Whatever that game's own DisplayModule last passed to ctx.setHighlight(), if anything — the Party Recap Reel's raw material. Most games never set one, and that's fine; the recap falls back to text-only superlatives for those. */
  highlightImage?: string;
  highlightCaption?: string;
}
