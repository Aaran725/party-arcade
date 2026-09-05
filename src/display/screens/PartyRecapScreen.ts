import { el, transitionOut } from "@shared/dom";
import type { PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";
import type { PartyHistoryEntry } from "../party/PartySession";
import { buildCards } from "../party/recapCards";

const CARD_MS = 4500;

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
