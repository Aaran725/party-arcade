import { el, transitionOut } from "@shared/dom";
import type { PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";
import { ACHIEVEMENTS } from "@shared/achievements";
import type { PartyHistoryEntry } from "../party/PartySession";
import { partyMvp, closestMomentEntry, biggestBlowoutEntry, winnerOf } from "../party/superlatives";
import { ICONS } from "./GameSelectScreen";

const CARD_MS = 4500;

interface Card {
  icon: string;
  title: string;
  body: string;
  image?: string;
  /** The MVP card shows a real avatar instead of just an emoji — the one moment in the recap worth that extra weight. */
  avatarPlayer?: PlayerInfo;
  line: string; // what the AI Leader says for this card, if it's on
}

function nameOf(players: PlayerInfo[], id: string | null): string {
  return (id && players.find((p) => p.id === id)?.name) || "Someone";
}

function buildCards(opts: {
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

export function renderPartyRecapScreen(
  root: HTMLElement,
  opts: {
    players: PlayerInfo[];
    standings: Record<string, number>;
    history: PartyHistoryEntry[];
    achievements: { playerId: string; achievementIds: string[] }[];
    onDone: () => void;
    /** Fired once per card as it's shown — the caller wires this to the AI Leader's hostSpeak(), a silent no-op when the Leader isn't on. */
    onCard?: (line: string) => void;
  },
): void {
  const cards = buildCards(opts);
  let index = 0;
  let timer = 0;
  let done = false;
  let panel: HTMLElement | null = null;

  // Guards against a stale timer/button firing after the host has already navigated away
  // (e.g. "End Party" mid-recap) — same pattern PartyNextScreen's own advance() uses —
  // only act while this screen's own panel is still the one mounted in root.
  const stillShowing = () => !done && panel !== null && panel.isConnected;

  const showCard = () => {
    const card = cards[index];
    if (!card) {
      finish();
      return;
    }
    opts.onCard?.(card.line);

    const skipBtn = el("button", { class: "glass-button" }, [index === cards.length - 1 ? "Continue →" : "Skip →"]);
    skipBtn.addEventListener("click", advance);

    transitionOut(root);
    panel = el("div", { class: "glass-panel finale-layout anim-pop-in" }, [
      el("p", { class: "text-caption" }, [`Recap ${index + 1} / ${cards.length}`]),
      card.avatarPlayer
        ? createAvatarSvg(card.avatarPlayer.id, card.avatarPlayer.color, { size: "5em" })
        : el("span", { style: "font-size:3rem" }, [card.icon]),
      el("h2", { class: "title-lg" }, [card.title]),
      ...(card.image ? [el("img", { src: card.image, style: "max-width:min(60vw,420px);max-height:40vh;border-radius:var(--radius-lg);box-shadow:var(--glass-shadow)" })] : []),
      el("p", { class: "text-body" }, [card.body]),
      skipBtn,
    ]);
    root.replaceChildren(panel);

    clearTimeout(timer);
    timer = window.setTimeout(advance, CARD_MS);
  };

  const advance = () => {
    if (!stillShowing()) return;
    clearTimeout(timer);
    index++;
    showCard();
  };

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    opts.onDone();
  };

  showCard();
}
