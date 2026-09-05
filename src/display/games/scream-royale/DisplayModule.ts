import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { createStageCanvas, roundRect, drawSpecularEdge, uiScale, wrapText } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx } from "@shared/audio";
import { ReactionGate } from "../../game-runtime/leaderReactions";
import { pickRecordLine } from "@shared/game-leader-lines";

const ROUND_COUNT = 3;
const RULES_MS = 6500;
const READY_MS = 3000;
const ACTIVE_MS = 4000;
const RESULT_MS = 2800;
const POINTS_BY_RANK = [25, 15, 8];
const PROMPTS = ["Scream as loud as you can!", "Laugh like it's the funniest thing ever!", "Cheer like your team just won!"];
const THEME = THEMES["scream-royale"];

const RULES_LINES = ["Three rounds, three prompts.", "Whoever's phone picks up the loudest peak wins the round.", "Only a loudness number is ever sent — never audio."];

type Phase = "rules" | "ready" | "active" | "result";

interface RankedResult {
  playerId: string;
  peak: number;
  rank: number;
  points: number;
}

function rankResults(peaks: { playerId: string; peak: number }[]): RankedResult[] {
  const sorted = [...peaks].sort((a, b) => b.peak - a.peak);
  const results: RankedResult[] = [];
  let rank = 0;
  let prevPeak: number | null = null;
  sorted.forEach((r, i) => {
    if (prevPeak === null || r.peak !== prevPeak) rank = i + 1;
    prevPeak = r.peak;
    results.push({ playerId: r.playerId, peak: r.peak, rank, points: POINTS_BY_RANK[rank - 1] ?? 0 });
  });
  return results;
}

export class ScreamRoyaleDisplay implements DisplayGameModule {
  id = "scream-royale" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  private roundIndex = 0;
  private phase: Phase = "rules";
  private phaseDeadline = 0;
  private currentLevel = new Map<string, number>();
  private peakThisRound = new Map<string, number>();
  private lastRoundResults: RankedResult[] = [];
  private allTimePeak = 0;
  private reactionGate = new ReactionGate();

  private particles: Particle[] = [];

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    for (const p of ctx.players) this.scores.set(p.id, 0);
    this.roundIndex = 0;
    this.phase = "rules";
    this.phaseDeadline = performance.now() + RULES_MS;
  }

  private connectedPlayers(): PlayerInfo[] {
    return this.gameCtx!.players.filter((p) => this.connectedIds.has(p.id));
  }

  private nameFor(id: string): string {
    return this.gameCtx!.players.find((p) => p.id === id)?.name ?? "Someone";
  }

  private startRound(): void {
    if (this.roundIndex >= ROUND_COUNT || this.connectedPlayers().length < 1) {
      this.finishGame();
      return;
    }
    this.currentLevel.clear();
    this.peakThisRound.clear();
    for (const p of this.connectedPlayers()) {
      this.currentLevel.set(p.id, 0);
      this.peakThisRound.set(p.id, 0);
    }
    this.phase = "ready";
    this.phaseDeadline = performance.now() + READY_MS;
  }

  private beginActive(): void {
    this.phase = "active";
    this.phaseDeadline = performance.now() + ACTIVE_MS;
    sfx.roundStart();
  }

  private resolveRound(): void {
    const ctx = this.gameCtx!;
    const peaks = this.connectedPlayers().map((p) => ({ playerId: p.id, peak: this.peakThisRound.get(p.id) ?? 0 }));
    this.lastRoundResults = rankResults(peaks);

    for (const r of this.lastRoundResults) {
      const score = (this.scores.get(r.playerId) ?? 0) + r.points;
      this.scores.set(r.playerId, score);
      ctx.onScoreUpdate(r.playerId, score);
      ctx.sendPrivate(r.playerId, { type: "scream-result", rank: r.rank, points: r.points, peak: r.peak });
    }

    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const winnerId = this.lastRoundResults[0]?.playerId;
    const winnerColor = this.connectedPlayers().find((p) => p.id === winnerId)?.color ?? "#FF453A";
    this.particles.push(...spawnBurst(w / 2, h * 0.5, winnerColor, 30, { speed: 220 }));
    sfx.hit(3);

    const winnerPeak = this.lastRoundResults[0]?.peak ?? 0;
    if (winnerId && winnerPeak > this.allTimePeak) {
      this.allTimePeak = winnerPeak;
      this.reactionGate.fire(ctx.hostSpeak, pickRecordLine(this.nameFor(winnerId)));
    }

    this.phase = "result";
    this.phaseDeadline = performance.now() + RESULT_MS;
    this.roundIndex += 1;
  }

  private finishGame(): void {
    const ctx = this.gameCtx!;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const colors = this.connectedPlayers().map((p) => p.color);
    this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, colors.length ? colors : ["#FF453A"], 70));
    sfx.gameOverFanfare();
    setTimeout(() => ctx.onGameOver(this.getScores()), 900);
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type !== "input:mic_level") return;
    if (this.phase !== "active" || !this.connectedIds.has(playerId)) return;
    this.currentLevel.set(playerId, msg.level);
    this.peakThisRound.set(playerId, Math.max(this.peakThisRound.get(playerId) ?? 0, msg.level));
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    this.currentLevel.delete(playerId);
    this.peakThisRound.delete(playerId);
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    switch (this.phase) {
      case "rules":
        if (now >= this.phaseDeadline) this.startRound();
        break;
      case "ready":
        if (now >= this.phaseDeadline) this.beginActive();
        break;
      case "active":
        if (now >= this.phaseDeadline) this.resolveRound();
        break;
      case "result":
        if (now >= this.phaseDeadline) this.startRound();
        break;
    }

    this.particles = stepParticles(this.particles, dt, now);
    this.draw(now);
  }

  private draw(now: number): void {
    const ctx = this.stage!.ctx;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);
    drawAmbientBackground(ctx, w, h, THEME, now);
    ctx.textAlign = "center";

    if (this.phase === "rules") {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `700 ${Math.round(30 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText("🎤 Scream Royale", w / 2, h * 0.22);
      ctx.font = `500 ${Math.round(19 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => wrapText(ctx, line, w / 2, h * 0.4 + i * 46, w * 0.75, 26));
      return;
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `600 ${Math.round(16 * uiScale(w, h))}px -apple-system, sans-serif`;
    ctx.fillText(`Round ${Math.min(this.roundIndex + 1, ROUND_COUNT)} / ${ROUND_COUNT}`, w / 2, 28);

    const prompt = PROMPTS[Math.min(this.roundIndex, PROMPTS.length - 1)];

    if (this.phase === "ready") {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${Math.round(28 * uiScale(w, h))}px -apple-system, sans-serif`;
      wrapText(ctx, prompt, w / 2, h * 0.42, w * 0.7, 34);
      ctx.font = `600 ${Math.round(20 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText("Get ready…", w / 2, h * 0.58);
      return;
    }

    if (this.phase === "active") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
      wrapText(ctx, prompt, w / 2, h * 0.14, w * 0.7, 30);
      this.drawBars(ctx, w, h);
      return;
    }

    // result
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
    ctx.fillText("Round results", w / 2, h * 0.12);
    const rowH = Math.min(70, (h * 0.7) / Math.max(1, this.lastRoundResults.length));
    this.lastRoundResults.forEach((r, i) => {
      const y = h * 0.2 + i * rowH;
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `600 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText(`#${r.rank}  ${this.nameFor(r.playerId)}`, w * 0.15, y);
      ctx.textAlign = "right";
      ctx.font = `700 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = THEME.accent;
      ctx.fillText(`peak ${r.peak}  +${r.points}`, w * 0.85, y);
    });
    ctx.textAlign = "center";
    drawParticles(ctx, this.particles, now);
  }

  private drawBars(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const players = this.connectedPlayers();
    if (players.length === 0) return;
    const pad = Math.min(w, h) * (24 / 675);
    const areaTop = h * 0.28;
    const areaBottom = h * 0.92;
    // Proportional cap (was a flat 90px, frozen regardless of screen size) — still keeps
    // bars from ballooning with very few players, but actually scales on a big TV.
    const barW = Math.min(w * 0.15, (w - pad * (players.length + 1)) / players.length);
    const totalW = barW * players.length + pad * (players.length - 1);
    const startX = (w - totalW) / 2;
    const barRadius = Math.min(14, barW * 0.2);

    players.forEach((p, i) => {
      const x = startX + i * (barW + pad);
      const level = this.currentLevel.get(p.id) ?? 0;
      const barH = ((areaBottom - areaTop) * level) / 100;

      ctx.fillStyle = "rgba(255,255,255,0.08)";
      roundRect(ctx, x, areaTop, barW, areaBottom - areaTop, barRadius);
      ctx.fill();

      if (barH > 1) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.9;
        roundRect(ctx, x, areaBottom - barH, barW, barH, Math.min(barRadius, barH / 2));
        ctx.fill();
        drawSpecularEdge(ctx, x, areaBottom - barH, barW, barH, Math.min(barRadius, barH / 2), 0.3);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `600 ${Math.round(14 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText(p.name, x + barW / 2, areaBottom + 22);
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
