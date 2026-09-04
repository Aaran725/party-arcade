import { el } from "@shared/dom";
import type { GameMeta, PlayerInfo } from "@shared/types/room";
import { ICONS } from "./GameSelectScreen";
import { scoreboard, teamScoreboard } from "./GameOverScreen";
import type { TeamAssignments } from "./PartySetupScreen";

const AUTO_ADVANCE_MS = 4000;

export function renderPartyNextScreen(
  root: HTMLElement,
  opts: {
    nextGame: GameMeta;
    standingsBlurb: string;
    standings: Record<string, number>;
    players: PlayerInfo[];
    roundNumber: number;
    totalRounds: number;
    onContinue: () => void;
    /** Skips the flat auto-advance timer — the caller (an active AI Game Leader) drives advance() itself once it's done speaking. */
    holdAutoAdvance?: boolean;
    /** Team Mode, when on — omitted for a solo/free-for-all party. */
    teams?: TeamAssignments;
    teamStandings?: Record<string, number>;
  },
): { advance: () => void } {
  let advanced = false;
  // Guards against a stale auto-advance timer firing after the host has already
  // navigated away from this screen (e.g. "End party") — only act while this
  // screen's own panel is still the one mounted in root.
  const advance = () => {
    if (advanced || !panel.isConnected) return;
    advanced = true;
    opts.onContinue();
  };

  const continueBtn = el("button", { class: "glass-button accent" }, [`Next: ${opts.nextGame.title} →`]);
  continueBtn.addEventListener("click", advance);

  const panel = el(
    "div",
    { class: "glass-panel party-next-layout anim-pop-in" },
    [
      el("p", { class: "text-caption" }, [`Round ${opts.roundNumber} of ${opts.totalRounds}`]),
      el("p", { class: "text-body" }, [opts.standingsBlurb]),
      el("div", { style: "display:flex;flex-direction:column;align-items:center;gap:0.4em" }, [
        el("span", { style: "font-size:3rem" }, [ICONS[opts.nextGame.id] ?? "🎮"]),
        el("h2", { class: "title-lg" }, [opts.nextGame.title]),
        el("p", { class: "text-body" }, [opts.nextGame.description]),
      ]),
      scoreboard(opts.players, opts.standings),
      ...(opts.teams && opts.teamStandings ? [teamScoreboard(opts.players, opts.teams, opts.teamStandings)] : []),
      continueBtn,
    ],
  );

  root.replaceChildren(panel);
  if (!opts.holdAutoAdvance) setTimeout(advance, AUTO_ADVANCE_MS);
  return { advance };
}
