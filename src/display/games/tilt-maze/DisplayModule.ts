import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import { createStageCanvas, drawSpecularEdge, roundRect, uiScale } from "../../game-runtime/canvas";
import { cellAt, generateMaze, type Maze } from "./maze";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { type ShakeState, createShakeState, triggerShake, withShake } from "../../game-runtime/shake";
import { type Popup, drawPopups, spawnPopup, stepPopups } from "../../game-runtime/popupText";
import { playNoiseBurst, sfx } from "@shared/audio";

const COLS = 11;
const ROWS = 7;
const TIME_LIMIT_MS = 45_000;
const BALL_RADIUS = 0.3;
const ACCEL = 26;
const DAMPING = 0.9;
const MAX_TILT_DEG = 28;
const BUMP_SPEED_THRESHOLD = 0.9;
const THEME = THEMES["tilt-maze"];

interface PlayerBall {
  id: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tiltX: number;
  tiltY: number;
  finishedAt: number | null;
  lastBumpAt: number;
}

interface Layout {
  cellPx: number;
  originX: number;
  originY: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class TiltMazeDisplay implements DisplayGameModule {
  id = "tilt-maze" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private maze: Maze = generateMaze(COLS, ROWS);
  private balls = new Map<string, PlayerBall>();
  private startedAt = 0;
  private ended = false;
  private finishOrder: string[] = [];

  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake: ShakeState = createShakeState();

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.maze = generateMaze(COLS, ROWS);
    this.startedAt = performance.now();
    this.ended = false;
    this.finishOrder = [];
    this.balls.clear();
    for (const p of ctx.players) {
      this.balls.set(p.id, { id: p.id, color: p.color, x: 0.5, y: 0.5, vx: 0, vy: 0, tiltX: 0, tiltY: 0, finishedAt: null, lastBumpAt: 0 });
    }
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type !== "input:tilt") return;
    const ball = this.balls.get(playerId);
    if (!ball) return;
    ball.tiltX = clamp(msg.gamma, -MAX_TILT_DEG, MAX_TILT_DEG) / MAX_TILT_DEG;
    ball.tiltY = clamp(msg.beta, -MAX_TILT_DEG, MAX_TILT_DEG) / MAX_TILT_DEG;
  }

  onPlayerLeave(playerId: string): void {
    this.balls.delete(playerId);
  }

  private layout(w: number, h: number): Layout {
    // Proportional (was a flat 40px, frozen regardless of screen size) — matches every
    // other game's layout() convention of scaling padding with the canvas itself.
    const pad = Math.min(w, h) * 0.06;
    const cellPx = Math.max(1, Math.min((w - pad * 2) / this.maze.cols, (h - pad * 2) / this.maze.rows));
    return { cellPx, originX: (w - cellPx * this.maze.cols) / 2, originY: (h - cellPx * this.maze.rows) / 2 };
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();
    const canvas = this.stage.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const layout = this.layout(w, h);

    if (!this.ended) {
      for (const ball of this.balls.values()) {
        if (ball.finishedAt !== null) continue;
        const bumped = this.stepBall(ball, dt);
        if (bumped && now - ball.lastBumpAt > 180) {
          ball.lastBumpAt = now;
          const px = layout.originX + ball.x * layout.cellPx;
          const py = layout.originY + ball.y * layout.cellPx;
          this.particles.push(...spawnBurst(px, py, "#ffffff", 6, { speed: 60, life: 220 }));
          playNoiseBurst({ duration: 0.08, gain: 0.14, filterFreq: 500 });
          triggerShake(this.shake, 2, 90);
        }
        if (Math.hypot(ball.vx, ball.vy) > 0.15) {
          const px = layout.originX + ball.x * layout.cellPx;
          const py = layout.originY + ball.y * layout.cellPx;
          this.particles.push(...spawnBurst(px, py, ball.color, 1, { speed: 4, life: 260, size: 1.6 }));
        }
        if (Math.floor(ball.x) === COLS - 1 && Math.floor(ball.y) === ROWS - 1) {
          ball.finishedAt = now;
          const rank = this.finishOrder.length;
          this.finishOrder.push(ball.id);
          const px = layout.originX + ball.x * layout.cellPx;
          const py = layout.originY + ball.y * layout.cellPx;
          this.particles.push(...spawnBurst(px, py, ball.color, 22, { speed: 200 }));
          this.popups.push(spawnPopup(px, py, rank === 0 ? "1st!" : rank === 1 ? "2nd!" : rank === 2 ? "3rd!" : "Finished!", "#30D158"));
          sfx.hit(Math.max(0, 3 - rank) * 4);
        }
      }

      const elapsed = now - this.startedAt;
      const allFinished = [...this.balls.values()].every((b) => b.finishedAt !== null);
      if ((allFinished && this.balls.size > 0) || elapsed >= TIME_LIMIT_MS) {
        this.finish(w, h);
        return;
      }
    }

    this.particles = stepParticles(this.particles, dt, now);
    this.popups = stepPopups(this.popups, now);

    this.draw(now, w, h, layout);
  }

  /** Returns true if this step's collision zeroed a meaningfully large velocity (a real wall bump). */
  private stepBall(ball: PlayerBall, dt: number): boolean {
    ball.vx = (ball.vx + ball.tiltX * ACCEL * dt) * DAMPING;
    ball.vy = (ball.vy + ball.tiltY * ACCEL * dt) * DAMPING;
    const preSpeed = Math.hypot(ball.vx, ball.vy);

    const cx = Math.floor(ball.x);
    const cy = Math.floor(ball.y);
    const cell = cellAt(this.maze, cx, cy);
    let bumped = false;

    let nx = ball.x + ball.vx * dt;
    if (cell) {
      if (ball.vx > 0 && cell.e && nx > cx + 1 - BALL_RADIUS) {
        nx = cx + 1 - BALL_RADIUS;
        ball.vx = 0;
        bumped = true;
      } else if (ball.vx < 0 && cell.w && nx < cx + BALL_RADIUS) {
        nx = cx + BALL_RADIUS;
        ball.vx = 0;
        bumped = true;
      }
    }
    ball.x = clamp(nx, BALL_RADIUS, this.maze.cols - BALL_RADIUS);

    let ny = ball.y + ball.vy * dt;
    if (cell) {
      if (ball.vy > 0 && cell.s && ny > cy + 1 - BALL_RADIUS) {
        ny = cy + 1 - BALL_RADIUS;
        ball.vy = 0;
        bumped = true;
      } else if (ball.vy < 0 && cell.n && ny < cy + BALL_RADIUS) {
        ny = cy + BALL_RADIUS;
        ball.vy = 0;
        bumped = true;
      }
    }
    ball.y = clamp(ny, BALL_RADIUS, this.maze.rows - BALL_RADIUS);

    return bumped && preSpeed > BUMP_SPEED_THRESHOLD;
  }

  getScores(): Record<string, number> {
    const scores: Record<string, number> = {};
    this.finishOrder.forEach((id, i) => {
      scores[id] = Math.max(100 - i * 20, 20);
    });
    for (const ball of this.balls.values()) {
      if (!(ball.id in scores)) scores[ball.id] = 0;
    }
    return scores;
  }

  private finish(w: number, h: number): void {
    this.ended = true;
    const scores: Record<string, number> = {};
    this.finishOrder.forEach((id, i) => {
      scores[id] = Math.max(100 - i * 20, 20);
      this.gameCtx?.onScoreUpdate(id, scores[id]);
    });
    for (const ball of this.balls.values()) {
      if (!(ball.id in scores)) {
        scores[ball.id] = 0;
        this.gameCtx?.onScoreUpdate(ball.id, 0);
      }
    }
    this.particles.push(...spawnConfetti(w, h, ["#64D2FF", "#30D158", "#FFD60A"], 60));
    sfx.gameOverFanfare();
    setTimeout(() => this.gameCtx?.onGameOver(scores), 900);
  }

  /** Small glass-chrome pill behind a centered HUD text label (e.g. the round timer), matching the shared badge look used elsewhere for floating overlay text. `ctx.font`/`textAlign` must already be set for the label; draw the label itself right after this call. */
  private drawHudBadge(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, fontSizePx: number): void {
    const textW = ctx.measureText(text).width;
    const padX = fontSizePx * 0.55;
    const padY = fontSizePx * 0.35;
    const badgeW = textW + padX * 2;
    const badgeH = fontSizePx * 0.97 + padY * 2;
    const badgeX = cx - badgeW / 2;
    const badgeY = y - fontSizePx * 0.75 - padY;
    ctx.fillStyle = "rgba(20,16,32,0.45)";
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, Math.min(badgeW, badgeH) * 0.25);
    ctx.fill();
    drawSpecularEdge(ctx, badgeX, badgeY, badgeW, badgeH, Math.min(badgeW, badgeH) * 0.25, 0.22);
  }

  private draw(now: number, w: number, h: number, layout: Layout): void {
    const ctx = this.stage!.ctx;
    const { cellPx, originX, originY } = layout;

    ctx.clearRect(0, 0, w, h);
    drawAmbientBackground(ctx, w, h, THEME, now);

    withShake(ctx, this.shake, now, () => {
      ctx.fillStyle = "rgba(48,209,88,0.25)";
      ctx.fillRect(originX + (this.maze.cols - 1) * cellPx, originY + (this.maze.rows - 1) * cellPx, cellPx, cellPx);

      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      for (let y = 0; y < this.maze.rows; y++) {
        for (let x = 0; x < this.maze.cols; x++) {
          const cell = cellAt(this.maze, x, y)!;
          const px = originX + x * cellPx;
          const py = originY + y * cellPx;
          ctx.beginPath();
          if (cell.n) { ctx.moveTo(px, py); ctx.lineTo(px + cellPx, py); }
          if (cell.w) { ctx.moveTo(px, py); ctx.lineTo(px, py + cellPx); }
          if (y === this.maze.rows - 1 && cell.s) { ctx.moveTo(px, py + cellPx); ctx.lineTo(px + cellPx, py + cellPx); }
          if (x === this.maze.cols - 1 && cell.e) { ctx.moveTo(px + cellPx, py); ctx.lineTo(px + cellPx, py + cellPx); }
          ctx.stroke();
        }
      }

      drawParticles(ctx, this.particles, now);

      for (const ball of this.balls.values()) {
        ctx.beginPath();
        ctx.fillStyle = ball.color;
        ctx.globalAlpha = ball.finishedAt !== null ? 0.4 : 1;
        ctx.arc(originX + ball.x * cellPx, originY + ball.y * cellPx, BALL_RADIUS * cellPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawPopups(ctx, this.popups, now);

      const remaining = Math.max(0, TIME_LIMIT_MS - (now - this.startedAt));
      const timerLabel = `${Math.ceil(remaining / 1000)}s`;
      const timerFontSize = Math.round(20 * uiScale(w, h));
      ctx.font = `600 ${timerFontSize}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      const timerY = originY - 14 < 20 ? 20 : originY - 14;
      this.drawHudBadge(ctx, w / 2, timerY, timerLabel, timerFontSize);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(timerLabel, w / 2, timerY);
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
