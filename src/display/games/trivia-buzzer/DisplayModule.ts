import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import { drawTriviaQuestions, type TriviaQuestion } from "@shared/trivia-bank";
import { createStageCanvas, roundRect, drawSpecularEdge } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { type ShakeState, createShakeState, triggerShake, withShake } from "../../game-runtime/shake";
import { type HitStopState, createHitStopState, effectiveDt, triggerHitStop } from "../../game-runtime/hitstop";
import { type Popup, drawPopups, spawnPopup, stepPopups } from "../../game-runtime/popupText";
import { ComboTracker } from "../../game-runtime/combo";
import { ReactionGate } from "../../game-runtime/leaderReactions";
import { pickComboLine } from "@shared/game-leader-lines";
import { sfx } from "@shared/audio";

const ROUND_COUNT = 8;
const ROUND_WINDOW_MS = 8000;
const ROUND_GAP_MS = 1400;
const COUNTDOWN_URGENT_MS = 3000;
const COMBO_REACTION_STREAK = 4;
const THEME = THEMES["trivia-buzzer"];

const CHOICE_COLORS = ["#FF375F", "#0A84FF", "#30D158", "#FFD60A"];

function speedBonus(remainingMs: number): number {
  if (remainingMs > ROUND_WINDOW_MS * 0.75) return 3;
  if (remainingMs > ROUND_WINDOW_MS * 0.4) return 2;
  return 1;
}

export class TriviaBuzzerDisplay implements DisplayGameModule {
  id = "trivia-buzzer" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private combos = new Map<string, ComboTracker>();

  private questions: TriviaQuestion[] = [];
  private roundIndex = 0;
  private roundActive = false;
  private roundDeadline = 0;
  private nextRoundAt = 0;
  private answeredThisRound = false;
  private flashUntil = 0;
  private flashCorrect = true;
  private lastCountdownTickAt = 0;

  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake: ShakeState = createShakeState();
  private hitStop: HitStopState = createHitStopState();
  private reactionGate = new ReactionGate();

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.ctx = this.stage.ctx;
    for (const p of ctx.players) {
      this.scores.set(p.id, 0);
      this.combos.set(p.id, new ComboTracker());
    }
    this.questions = drawTriviaQuestions(ROUND_COUNT);
    this.roundIndex = 0;
    this.nextRoundAt = performance.now() + 900;
  }

  private currentQuestion(): TriviaQuestion | null {
    return this.questions[this.roundIndex - 1] ?? null;
  }

  private startRound(): void {
    this.roundIndex += 1;
    this.roundActive = true;
    this.answeredThisRound = false;
    this.roundDeadline = performance.now() + ROUND_WINDOW_MS;
    this.lastCountdownTickAt = 0;
    sfx.roundStart();
  }

  private endRound(winnerId: string | null, remainingMs = 0): void {
    this.roundActive = false;
    const now = performance.now();
    this.flashUntil = now + 260;
    this.flashCorrect = winnerId !== null;

    if (winnerId) {
      const combo = this.combos.get(winnerId);
      const streak = combo?.registerWin() ?? 1;
      const bonus = speedBonus(remainingMs);
      const delta = Math.max(1, Math.round(bonus * (combo?.multiplier ?? 1)));
      const score = (this.scores.get(winnerId) ?? 0) + delta;
      this.scores.set(winnerId, score);
      this.gameCtx?.onScoreUpdate(winnerId, score);
      this.gameCtx?.sendPrivate(winnerId, { type: "reaction-result", correct: true });

      const canvas = this.stage?.canvas;
      const dpr = window.devicePixelRatio || 1;
      if (canvas) {
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        this.particles.push(...spawnBurst(w / 2, h * 0.55, "#ffffff", 16));
        this.popups.push(spawnPopup(w / 2, h * 0.55, bonus >= 3 ? `+${delta} FAST!` : `+${delta}`, "#ffffff"));
      }
      sfx.hit(streak - 1 + bonus);
      if (streak > 1) sfx.comboTick(streak);
      triggerHitStop(this.hitStop, now, 40);
      triggerShake(this.shake, 4, 160);

      if (streak >= COMBO_REACTION_STREAK && this.gameCtx) {
        const name = this.gameCtx.players.find((p) => p.id === winnerId)?.name ?? "Someone";
        this.reactionGate.fire(this.gameCtx.hostSpeak, pickComboLine(name, streak));
      }
    } else {
      for (const combo of this.combos.values()) combo.registerMiss();
      sfx.miss();
    }

    if (this.roundIndex >= ROUND_COUNT) {
      const canvas = this.stage?.canvas;
      const dpr = window.devicePixelRatio || 1;
      if (canvas) this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, CHOICE_COLORS, 60));
      sfx.gameOverFanfare();
      setTimeout(() => this.gameCtx?.onGameOver(this.getScores()), 900);
      return;
    }
    this.nextRoundAt = now + ROUND_GAP_MS;
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type !== "input:button" || !msg.pressed) return;
    if (!this.roundActive || this.answeredThisRound) return;
    const q = this.currentQuestion();
    if (!q) return;
    if (msg.buttonId === String(q.correctIndex)) {
      this.answeredThisRound = true;
      this.endRound(playerId, this.roundDeadline - performance.now());
    } else {
      this.gameCtx?.sendPrivate(playerId, { type: "reaction-result", correct: false });
    }
  }

  onPlayerLeave(playerId: string): void {
    this.scores.delete(playerId);
    this.combos.delete(playerId);
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    if (!this.roundActive && this.roundIndex < ROUND_COUNT && now >= this.nextRoundAt) {
      this.startRound();
    }
    if (this.roundActive) {
      const remaining = this.roundDeadline - now;
      if (remaining <= COUNTDOWN_URGENT_MS && now - this.lastCountdownTickAt >= 1000) {
        this.lastCountdownTickAt = now;
        sfx.countdownTick(true);
      }
      if (remaining <= 0) this.endRound(null);
    }

    const physicsDt = effectiveDt(this.hitStop, now, dt);
    this.particles = stepParticles(this.particles, physicsDt, now);
    this.popups = stepPopups(this.popups, now);

    this.draw(now);
  }

  private draw(now: number): void {
    const ctx = this.ctx!;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);
    drawAmbientBackground(ctx, w, h, THEME, now);

    withShake(ctx, this.shake, now, () => {
      const q = this.currentQuestion();
      if (q) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "600 26px -apple-system, sans-serif";
        ctx.textAlign = "center";
        wrapText(ctx, q.question, w / 2, h * 0.22, w * 0.8, 34);

        const cols = 2;
        const rows = 2;
        const pad = w * 0.12;
        const gap = 24;
        const gridW = w - pad * 2;
        const gridH = h * 0.42;
        const cellW = (gridW - gap) / cols;
        const cellH = (gridH - gap) / rows;
        const originX = pad;
        const originY = h * 0.42;

        q.choices.forEach((choice, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = originX + col * (cellW + gap);
          const y = originY + row * (cellH + gap);
          ctx.globalAlpha = this.roundActive ? 1 : 0.5;
          ctx.fillStyle = CHOICE_COLORS[i];
          roundRect(ctx, x, y, cellW, cellH, 18);
          ctx.fill();
          drawSpecularEdge(ctx, x, y, cellW, cellH, 18, 0.28);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(0,0,0,0.85)";
          ctx.font = "600 18px -apple-system, sans-serif";
          wrapText(ctx, choice, x + cellW / 2, y + cellH / 2, cellW * 0.85, 22);
        });
      }

      if (this.roundActive) {
        const remaining = this.roundDeadline - now;
        if (remaining <= COUNTDOWN_URGENT_MS) {
          const pulse = 0.08 + 0.06 * Math.sin(now / 130);
          ctx.fillStyle = `rgba(255,55,95,${pulse})`;
          ctx.fillRect(0, 0, w, h);
        }
      }

      if (now < this.flashUntil) {
        ctx.fillStyle = this.flashCorrect ? "rgba(48,209,88,0.18)" : "rgba(255,55,95,0.18)";
        ctx.fillRect(0, 0, w, h);
      }

      drawParticles(ctx, this.particles, now);
      drawPopups(ctx, this.popups, now);

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "600 16px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Question ${Math.min(this.roundIndex, ROUND_COUNT)} / ${ROUND_COUNT}`, w / 2, 28);
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
    this.ctx = null;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const totalHeight = lines.length * lineHeight;
  const startY = cy - totalHeight / 2 + lineHeight / 2;
  const prevBaseline = ctx.textBaseline;
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
  ctx.textBaseline = prevBaseline;
}
