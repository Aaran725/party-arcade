import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { drawWordEntries } from "@shared/word-bank";
import { createStageCanvas, roundRect, drawSpecularEdge, uiScale } from "../../game-runtime/canvas";
import { PhaseMachine } from "../../game-runtime/roundEngine";
import { connectedPlayers } from "../../game-runtime/players";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx } from "@shared/audio";

const RULES_MS = 6500;
const DRAWING_MS = 45_000;
const JUDGING_TIMEOUT_MS = 15_000;
const REVEAL_HOLD_MS = 6000;
const OFFSCREEN_W = 360;
const OFFSCREEN_H = 480;
const POINTS_BY_RANK = [25, 15, 8]; // rank 4+ = 0
const PREDICTION_BONUS = 5;
const THEME = THEMES["draw-off"];

const RULES_LINES = [
  "Everyone draws the same word at the same time.",
  "When time's up, an AI judges every drawing 0-100.",
  "Best drawing wins the most points — ties share the rank.",
];

type Phase = "rules" | "drawing" | "judging" | "reveal";

interface RankedResult {
  playerId: string;
  score: number;
  comment: string;
  rank: number;
  points: number;
}

function gridLayout(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  return { cols: 4, rows: 2 };
}

/** Ink-coverage heuristic — the always-available fallback score, computed before any AI call is even sent. */
function heuristicScore(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const { data } = ctx.getImageData(0, 0, w, h);
  let inked = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 10) inked++;
  const coverage = inked / (w * h);
  const idealLow = 0.03;
  const idealHigh = 0.22;
  let score: number;
  if (coverage < idealLow) score = (coverage / idealLow) * 55;
  else if (coverage <= idealHigh) score = 55 + ((coverage - idealLow) / (idealHigh - idealLow)) * 35;
  else score = Math.max(35, 90 - (coverage - idealHigh) * 120);
  return Math.round(Math.max(10, Math.min(92, score)));
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(" ");
  let line = "";
  let lineY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
}

export class DrawOffDisplay implements DisplayGameModule {
  id = "draw-off" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  private word = "";
  private resultsFinalized = false;

  private readonly phases = new PhaseMachine<Phase>(
    "rules",
    {
      rules: { onExpire: () => this.beginDrawing() },
      drawing: { onExpire: () => this.beginJudging(), countdownTicks: true },
      judging: { onExpire: () => this.finalizeResults(new Map()) },
      // "reveal" is terminal — entered with no deadline, held open by phases.finish().
    },
    { onCountdownTick: () => sfx.countdownTick(true) },
  );

  private canvases = new Map<string, HTMLCanvasElement>();
  private canvasCtxs = new Map<string, CanvasRenderingContext2D>();
  private lastPoint = new Map<string, { x: number; y: number }>();
  private strokeHistory = new Map<string, { points: { x: number; y: number }[]; color: string; lineWidth: number }[]>();
  private heuristicScores = new Map<string, number>();
  private rankedResults: RankedResult[] = [];
  // Companion Spectator Mode: while the AI judges, everyone can predict who'll score
  // highest, for a small bonus — a fun side-bet during the one genuinely suspenseful wait
  // in this game.
  private predictions = new Map<string, string>();

  private particles: Particle[] = [];

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    for (const p of ctx.players) {
      this.scores.set(p.id, 0);
      const canvas = document.createElement("canvas");
      canvas.width = OFFSCREEN_W;
      canvas.height = OFFSCREEN_H;
      this.canvases.set(p.id, canvas);
      this.canvasCtxs.set(p.id, canvas.getContext("2d")!);
      this.strokeHistory.set(p.id, []);
    }
    this.word = drawWordEntries(1)[0].word;
    this.phases.setPhase("rules", RULES_MS);
    this.resultsFinalized = false;
  }

  private connectedPlayers(): PlayerInfo[] {
    return connectedPlayers(this.gameCtx!.players, this.connectedIds);
  }

  private nameFor(id: string): string {
    return this.gameCtx!.players.find((p) => p.id === id)?.name ?? "Someone";
  }

  private beginDrawing(): void {
    const ctx = this.gameCtx!;
    for (const p of this.connectedPlayers()) ctx.sendPrivate(p.id, { word: this.word });
    this.phases.setPhase("drawing", DRAWING_MS);
    sfx.roundStart();
  }

  private beginJudging(): void {
    const ctx = this.gameCtx!;
    const submissions: { playerId: string; imageData: string }[] = [];
    for (const p of this.connectedPlayers()) {
      const canvas = this.canvases.get(p.id);
      const cctx = this.canvasCtxs.get(p.id);
      if (!canvas || !cctx) continue;
      this.heuristicScores.set(p.id, heuristicScore(cctx, OFFSCREEN_W, OFFSCREEN_H));
      submissions.push({ playerId: p.id, imageData: canvas.toDataURL("image/png") });
    }
    ctx.requestRating(this.word, submissions);
    this.phases.setPhase("judging", JUDGING_TIMEOUT_MS);
    sfx.uiTap();

    this.predictions.clear();
    const candidates = this.connectedPlayers().map((p) => ({ id: p.id, name: p.name }));
    for (const p of this.connectedPlayers()) ctx.sendPrivate(p.id, { phase: "predict", candidates });
  }

  onRatingsResult(ratings: { playerId: string; score: number | null; comment: string | null }[]): void {
    if (this.phases.phase !== "judging" || this.resultsFinalized) return;
    const byId = new Map(ratings.map((r) => [r.playerId, r]));
    this.finalizeResults(byId);
  }

  private finalizeResults(aiRatings: Map<string, { score: number | null; comment: string | null }>): void {
    if (this.resultsFinalized) return;
    this.resultsFinalized = true;
    const ctx = this.gameCtx!;

    const raw = this.connectedPlayers().map((p) => {
      const ai = aiRatings.get(p.id);
      if (ai && ai.score !== null) {
        return { playerId: p.id, score: ai.score, comment: ai.comment || "Nicely done." };
      }
      return { playerId: p.id, score: this.heuristicScores.get(p.id) ?? 0, comment: "Judged the old-fashioned way." };
    });
    raw.sort((a, b) => b.score - a.score);

    this.rankedResults = [];
    let rank = 0;
    let prevScore: number | null = null;
    raw.forEach((r, i) => {
      if (prevScore === null || r.score !== prevScore) rank = i + 1;
      prevScore = r.score;
      const points = POINTS_BY_RANK[rank - 1] ?? 0;
      this.rankedResults.push({ ...r, rank, points });
    });

    for (const r of this.rankedResults) {
      const score = (this.scores.get(r.playerId) ?? 0) + r.points;
      this.scores.set(r.playerId, score);
      ctx.onScoreUpdate(r.playerId, score);
      ctx.sendPrivate(r.playerId, { score: r.score, comment: r.comment, rank: r.rank, points: r.points });
    }

    const winnerId = this.rankedResults[0]?.playerId;
    if (winnerId) {
      for (const [predictorId, targetId] of this.predictions) {
        if (targetId !== winnerId) continue;
        const score = (this.scores.get(predictorId) ?? 0) + PREDICTION_BONUS;
        this.scores.set(predictorId, score);
        ctx.onScoreUpdate(predictorId, score);
      }
    }

    // Terminal phase: no deadline of its own — phases.finish() below holds it until game-over.
    this.phases.setPhase("reveal");
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const winnerColor = this.connectedPlayers().find((p) => p.id === this.rankedResults[0]?.playerId)?.color;
    this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, winnerColor ? [winnerColor, "#BF5AF2", "#FFD60A"] : ["#BF5AF2"], 70));
    sfx.gameOverFanfare();
    const winner = this.rankedResults[0];
    if (winner) {
      ctx.hostSpeak(`The winning drawing came from ${this.nameFor(winner.playerId)}, scoring ${winner.score} out of 100. ${winner.comment}`);
      const winnerCanvas = this.canvases.get(winner.playerId);
      if (winnerCanvas) {
        ctx.setHighlight(winnerCanvas.toDataURL("image/png"), `${this.nameFor(winner.playerId)}'s winning drawing — ${winner.score}/100`);
      }
    }
    this.phases.finish(REVEAL_HOLD_MS, () => ctx.onGameOver(this.getScores()));
  }

  private drawStroke(playerId: string, msg: Extract<InputMessage, { type: "input:draw" }>): void {
    const cctx = this.canvasCtxs.get(playerId);
    const history = this.strokeHistory.get(playerId);
    if (!cctx || !history) return;

    if (msg.phase === "undo" || msg.phase === "clear") {
      if (msg.phase === "undo") history.pop();
      else history.length = 0;
      this.redrawPlayer(playerId);
      return;
    }

    const lineWidth = msg.lineWidth ?? 5;
    cctx.strokeStyle = msg.color;
    cctx.lineWidth = lineWidth;
    cctx.lineCap = "round";
    cctx.lineJoin = "round";

    if (msg.phase === "start") history.push({ points: [], color: msg.color, lineWidth });
    const stroke = history[history.length - 1];

    let last = this.lastPoint.get(playerId) ?? { x: 0, y: 0 };
    if (msg.phase === "start" && msg.points[0]) {
      last = { x: msg.points[0].x * OFFSCREEN_W, y: msg.points[0].y * OFFSCREEN_H };
      stroke?.points.push(msg.points[0]);
      cctx.beginPath();
      cctx.fillStyle = msg.color;
      cctx.arc(last.x, last.y, 2, 0, Math.PI * 2);
      cctx.fill();
    }
    const rest = msg.phase === "start" ? msg.points.slice(1) : msg.points;
    for (const pt of rest) {
      stroke?.points.push(pt);
      const x = pt.x * OFFSCREEN_W;
      const y = pt.y * OFFSCREEN_H;
      cctx.beginPath();
      cctx.moveTo(last.x, last.y);
      cctx.lineTo(x, y);
      cctx.stroke();
      last = { x, y };
    }
    this.lastPoint.set(playerId, last);
  }

  /** Full repaint from stroke history — the only way to remove ink already committed to a raster canvas. */
  private redrawPlayer(playerId: string): void {
    const canvas = this.canvases.get(playerId);
    const cctx = this.canvasCtxs.get(playerId);
    const history = this.strokeHistory.get(playerId);
    if (!canvas || !cctx || !history) return;

    cctx.clearRect(0, 0, OFFSCREEN_W, OFFSCREEN_H);
    cctx.lineCap = "round";
    cctx.lineJoin = "round";
    for (const stroke of history) {
      const [first] = stroke.points;
      if (!first) continue;
      cctx.strokeStyle = stroke.color;
      cctx.fillStyle = stroke.color;
      cctx.lineWidth = stroke.lineWidth;
      cctx.beginPath();
      cctx.arc(first.x * OFFSCREEN_W, first.y * OFFSCREEN_H, 2, 0, Math.PI * 2);
      cctx.fill();
      cctx.beginPath();
      stroke.points.forEach((pt, i) => {
        const x = pt.x * OFFSCREEN_W;
        const y = pt.y * OFFSCREEN_H;
        if (i === 0) cctx.moveTo(x, y);
        else cctx.lineTo(x, y);
      });
      cctx.stroke();
    }
    this.lastPoint.delete(playerId);
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type === "input:prediction") {
      if (this.phases.phase !== "judging" || !this.connectedIds.has(playerId)) return;
      if (this.connectedIds.has(msg.targetPlayerId)) this.predictions.set(playerId, msg.targetPlayerId);
      return;
    }
    if (msg.type !== "input:draw") return;
    if (this.phases.phase !== "drawing" || !this.connectedIds.has(playerId)) return;
    this.drawStroke(playerId, msg);
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    this.phases.tick(now, dt);

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

    if (this.phases.phase === "rules") {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `700 ${Math.round(30 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText("🖼️ Draw-Off", w / 2, h * 0.25);
      ctx.font = `500 ${Math.round(19 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => wrapText(ctx, line, w / 2, h * 0.42 + i * 46, w * 0.75, 26));
      return;
    }

    if (this.phases.phase === "drawing") {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText(`Draw: ${this.word}`, w / 2, h * 0.065);
      const remaining = this.phases.remaining(now);
      ctx.font = `600 ${Math.round(16 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(`${Math.ceil(remaining / 1000)}s`, w / 2, h * 0.11);

      const players = this.connectedPlayers();
      const { cols, rows } = gridLayout(players.length);
      const pad = Math.min(w, h) * (14 / 675);
      const top = h * 0.16;
      const cellW = (w - pad * (cols + 1)) / cols;
      const cellH = (h - top - pad * (rows + 1)) / rows;

      players.forEach((p, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = pad + col * (cellW + pad);
        const y = top + pad + row * (cellH + pad);

        const cellRadius = Math.min(16, cellW * 0.06, cellH * 0.06);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        roundRect(ctx, x, y, cellW, cellH, cellRadius);
        ctx.fill();

        const srcCanvas = this.canvases.get(p.id);
        if (srcCanvas) {
          const scale = Math.min(cellW / OFFSCREEN_W, cellH / OFFSCREEN_H);
          const dw = OFFSCREEN_W * scale;
          const dh = OFFSCREEN_H * scale;
          ctx.save();
          roundRect(ctx, x, y, cellW, cellH, cellRadius);
          ctx.clip();
          ctx.drawImage(srcCanvas, 0, 0, OFFSCREEN_W, OFFSCREEN_H, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);
          ctx.restore();
        }

        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, x, y, cellW, cellH, cellRadius);
        ctx.stroke();
        drawSpecularEdge(ctx, x, y, cellW, cellH, cellRadius, 0.22);

        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.font = `600 ${Math.round(13 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillText(p.name, x + cellW / 2, y + cellH - 8);
      });
      return;
    }

    if (this.phases.phase === "judging") {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${Math.round(26 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText("🤖 AI is judging your drawings", w / 2, h * 0.46);
      const dots = ".".repeat((Math.floor(now / 400) % 3) + 1);
      ctx.font = `600 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(dots, w / 2, h * 0.54);
      drawParticles(ctx, this.particles, now);
      return;
    }

    // reveal
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
    ctx.fillText(`The word was: ${this.word}`, w / 2, h * 0.08);

    const rowH = Math.min(96, (h * 0.86) / Math.max(1, this.rankedResults.length));
    this.rankedResults.forEach((r, i) => {
      const y = h * 0.14 + i * rowH;
      const canvas = this.canvases.get(r.playerId);
      const thumbH = rowH * 0.82;
      const thumbW = thumbH * (OFFSCREEN_W / OFFSCREEN_H);
      const thumbRadius = Math.min(12, thumbH * 0.08);
      if (canvas) {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        roundRect(ctx, w * 0.06, y, thumbW, thumbH, thumbRadius);
        ctx.fill();
        ctx.save();
        roundRect(ctx, w * 0.06, y, thumbW, thumbH, thumbRadius);
        ctx.clip();
        ctx.drawImage(canvas, 0, 0, OFFSCREEN_W, OFFSCREEN_H, w * 0.06, y, thumbW, thumbH);
        ctx.restore();
        drawSpecularEdge(ctx, w * 0.06, y, thumbW, thumbH, thumbRadius, 0.22);
      }

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText(`#${r.rank}  ${this.nameFor(r.playerId)}`, w * 0.06 + thumbW + 18, y + rowH * 0.32);
      ctx.font = `500 ${Math.round(13 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText(r.comment, w * 0.06 + thumbW + 18, y + rowH * 0.6, w * 0.5);

      ctx.textAlign = "right";
      ctx.font = `700 ${Math.round(20 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = THEME.accent;
      ctx.fillText(`${r.score}/100`, w * 0.94, y + rowH * 0.35);
      ctx.font = `600 ${Math.round(14 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(`+${r.points}`, w * 0.94, y + rowH * 0.6);
    });

    drawParticles(ctx, this.particles, now);
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
