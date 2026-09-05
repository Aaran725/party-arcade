import type { PlayerInfo } from "@shared/types/room";
import { ACHIEVEMENTS } from "@shared/achievements";
import type { PartyHistoryEntry } from "./PartySession";
import { partyMvp, closestMomentEntry, biggestBlowoutEntry, winnerOf } from "./superlatives";
import { ICONS } from "../screens/GameSelectScreen";

export interface Card {
  icon: string;
  title: string;
  body: string;
  image?: string;
  /** The MVP card shows a real avatar instead of just an emoji — the one moment in the recap worth that extra weight. */
  avatarPlayer?: PlayerInfo;
  line: string; // what the AI Leader says for this card, if it's on
}

export function nameOf(players: PlayerInfo[], id: string | null): string {
  return (id && players.find((p) => p.id === id)?.name) || "Someone";
}

/**
 * Assembles the party recap's sequence of cards (MVP, closest call, biggest blowout,
 * highlights, achievements) from raw party data — the one place this logic lives, shared
 * by the on-screen recap reel (PartyRecapScreen.ts) and the shareable recap image
 * (recapImage.ts) so the two never drift on what counts as a superlative.
 */
export function buildCards(opts: {
  players: PlayerInfo[];
  standings: Record<string, number>;
  history: PartyHistoryEntry[];
  achievements: { playerId: string; achievementIds: string[] }[];
}): Card[] {
  const cards: Card[] = [
    { icon: "🎬", title: "Party Recap", body: `${opts.history.length} game${opts.history.length === 1 ? "" : "s"} played tonight`, line: "Alright, let's relive tonight's highlights before we crown a winner." },
  ];

  const mvpId = partyMvp(opts.standings);
  if (mvpId) {
    const score = opts.standings[mvpId] ?? 0;
    const mvpPlayer = opts.players.find((p) => p.id === mvpId);
    cards.push({
      icon: "🏆",
      title: `${nameOf(opts.players, mvpId)} — Party MVP`,
      body: `${score} points across the whole party`,
      avatarPlayer: mvpPlayer,
      line: `Tonight's MVP, with the most points across every game, is ${nameOf(opts.players, mvpId)}!`,
    });
  }

  const closest = closestMomentEntry(opts.history);
  if (closest) {
    const ranked = Object.entries(closest.scores).sort((a, b) => b[1] - a[1]);
    const [aId, aScore] = ranked[0];
    const [bId, bScore] = ranked[1];
    cards.push({
      icon: ICONS[closest.gameId] ?? "🎮",
      title: "Closest Call",
      body: `${nameOf(opts.players, aId)} edged out ${nameOf(opts.players, bId)}, ${aScore}-${bScore}`,
      image: closest.highlightImage,
      line: `The closest call tonight: ${nameOf(opts.players, aId)} barely beat ${nameOf(opts.players, bId)}.`,
    });
  }

  const blowout = biggestBlowoutEntry(opts.history);
  if (blowout && blowout !== closest) {
    const ranked = Object.entries(blowout.scores).sort((a, b) => b[1] - a[1]);
    const winnerId = ranked[0]?.[0] ?? null;
    cards.push({
      icon: ICONS[blowout.gameId] ?? "🎮",
      title: "Biggest Blowout",
      body: `${nameOf(opts.players, winnerId)} dominated — nobody else came close`,
      image: blowout.highlightImage,
      line: `The biggest blowout of the night belonged to ${nameOf(opts.players, winnerId)}.`,
    });
  }

  // Every captured highlight image not already shown above — the actual drawings/photos.
  const shownImages = new Set([closest?.highlightImage, blowout?.highlightImage].filter(Boolean));
  for (const entry of opts.history) {
    if (!entry.highlightImage || shownImages.has(entry.highlightImage)) continue;
    shownImages.add(entry.highlightImage);
    const winnerId = winnerOf(entry.scores);
    cards.push({
      icon: ICONS[entry.gameId] ?? "🎮",
      title: entry.highlightCaption ?? "Highlight",
      body: nameOf(opts.players, winnerId),
      image: entry.highlightImage,
      line: entry.highlightCaption ?? "Here's a highlight from tonight.",
    });
  }

  if (opts.achievements.length > 0) {
    const lines = opts.achievements.map(({ playerId, achievementIds }) => {
      const names = achievementIds.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.title ?? id).join(", ");
      return `${nameOf(opts.players, playerId)}: ${names}`;
    });
    cards.push({
      icon: "🎉",
      title: "Achievements Unlocked",
      body: lines.join(" · "),
      line: "And a few achievements were unlocked tonight too — nice work, everyone.",
    });
  }

  return cards;
}
