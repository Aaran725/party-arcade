import { el } from "@shared/dom";
import type { PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";
import { PLAYER_COLORS } from "@shared/colors";
import { createStageCanvas } from "../game-runtime/canvas";
import { type Particle, spawnConfetti, stepParticles, drawParticles } from "../game-runtime/particles";
import { sfx } from "@shared/audio";
import { ICONS } from "./GameSelectScreen";
import { scoreboard, teamScoreboard } from "./GameOverScreen";
import type { PartyHistoryEntry } from "../party/PartySession";
import type { TeamAssignments } from "./PartySetupScreen";
import { winnerOf, closestMomentEntry } from "../party/superlatives";
import { renderRecapImageCard } from "../party/recapImage";

const CONFETTI_DURATION_MS = 3000;
const CONFETTI_COUNT = 180;

export function renderPartyFinaleScreen(
  root: HTMLElement,
  opts: {
    players: PlayerInfo[];
    standings: Record<string, number>;
    history: PartyHistoryEntry[];
    onNewParty: () => void;
    /** Team Mode, when on — omitted for a solo/free-for-all party. */
    teams?: TeamAssignments;
    teamStandings?: Record<string, number>;
    /** Only needed for the shareable recap image's achievement badges — the on-screen finale itself doesn't show them. */
    achievements?: { playerId: string; achievementIds: string[] }[];
  },
): void {
  const ranked = Object.entries(opts.standings).sort((a, b) => b[1] - a[1]);
  const winnerId = ranked[0]?.[0] ?? null;
  const winner = winnerId ? opts.players.find((p) => p.id === winnerId) : undefined;

  const canvasHost = el("div", { class: "finale-canvas" });

  const recap = opts.history.map((entry) => {
    const wId = winnerOf(entry.scores);
    const wName = wId ? opts.players.find((p) => p.id === wId)?.name ?? "—" : "—";
    return el("div", { class: "glass-pill party-recap-item" }, [
      el("span", { class: "icon" }, [ICONS[entry.gameId] ?? "🎮"]),
      el("span", { class: "text-caption" }, [wName]),
    ]);
  });

  const closest = closestMomentEntry(opts.history);
  let closestNode: HTMLElement | null = null;
  if (closest) {
    const closestRanked = Object.entries(closest.scores).sort((a, b) => b[1] - a[1]);
    const [aId, aScore] = closestRanked[0];
    const [bId, bScore] = closestRanked[1];
    const aName = opts.players.find((p) => p.id === aId)?.name ?? "—";
    const bName = opts.players.find((p) => p.id === bId)?.name ?? "—";
    closestNode = el("p", { class: "text-body" }, [
      `Closest moment: ${ICONS[closest.gameId] ?? "🎮"} ${aName} edged out ${bName}, ${aScore}-${bScore}.`,
    ]);
  }

  const newPartyBtn = el("button", { class: "glass-button accent" }, ["New party"]);
  newPartyBtn.addEventListener("click", opts.onNewParty);

  const shareBtn = el("button", { class: "glass-button" }, ["Share recap"]);
  shareBtn.addEventListener("click", async () => {
    shareBtn.setAttribute("disabled", "");
    shareBtn.textContent = "Generating…";
    try {
      const dataUrl = await renderRecapImageCard({
        players: opts.players,
        standings: opts.standings,
        history: opts.history,
        achievements: opts.achievements ?? [],
      });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "party-recap.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Party Arcade Recap" }).catch(() => {});
      } else {
        const a = el("a", { href: dataUrl, download: "party-recap.png" });
        a.click();
      }
    } finally {
      shareBtn.removeAttribute("disabled");
      shareBtn.textContent = "Share recap";
    }
  });

  const heading: (Node | string)[] = winner
    ? [createAvatarSvg(winner.id, winner.color, { size: "8em" }), el("h1", { class: "title-xl" }, [`${winner.name} wins the party!`])]
    : [el("h1", { class: "title-xl" }, ["Party complete!"])];

  const panel = el("div", { class: "glass-panel finale-layout anim-pop-in" }, [
    canvasHost,
    el("p", { class: "text-caption" }, ["The party's over"]),
    ...heading,
    ...(recap.length ? [el("div", { class: "party-recap-strip" }, recap)] : []),
    ...(closestNode ? [closestNode] : []),
    scoreboard(opts.players, opts.standings),
    ...(opts.teams && opts.teamStandings ? [teamScoreboard(opts.players, opts.teams, opts.teamStandings)] : []),
    el("div", { style: "display:flex;gap:0.6em" }, [shareBtn, newPartyBtn]),
  ]);

  root.replaceChildren(panel);

  const { canvas, ctx, dispose } = createStageCanvas(canvasHost);
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  let particles: Particle[] = spawnConfetti(w, h, PLAYER_COLORS, CONFETTI_COUNT);
  sfx.gameOverFanfare();

  const start = performance.now();
  let lastFrame = start;
  function frame(now: number): void {
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    particles = stepParticles(particles, dt, now);
    ctx.clearRect(0, 0, w, h);
    drawParticles(ctx, particles, now);
    if (now - start < CONFETTI_DURATION_MS && panel.isConnected) {
      requestAnimationFrame(frame);
    } else {
      dispose();
    }
  }
  requestAnimationFrame(frame);
}
