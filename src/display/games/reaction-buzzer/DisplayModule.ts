import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import { createStageCanvas, roundRect, drawSpecularEdge, uiScale } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { type ShakeState, createShakeState, triggerShake, withShake } from "../../game-runtime/shake";
import { type HitStopState, createHitStopState, effectiveDt, triggerHitStop } from "../../game-runtime/hitstop";
import { type Popup, drawPopups, spawnPopup, stepPopups } from "../../game-runtime/popupText";
import { ComboTracker } from "../../game-runtime/combo";
import { ReactionGate } from "../../game-runtime/leaderReactions";
import { pickComboLine } from "@shared/game-leader-lines";
import { sfx } from "@shared/audio";

const COMBO_REACTION_STREAK = 4;

const GRID_SIZE = 3;
const TILE_COUNT = GRID_SIZE * GRID_SIZE;
const ROUND_COUNT = 10;
const ROUND_WINDOW_MS = 2200;
const ROUND_GAP_MS = 700;
const THEME = THEMES["reaction-buzzer"];

const TILE_COLORS = [
  "#FF375F", "#0A84FF", "#30D158", "#FFD60A", "#BF5AF2", "#FF9F0A", "#64D2FF", "#FF6482", "#5E5CE6",
];

interface Layout {
  originX: number;
  originY: number;
  tileSize: number;
  gap: number;
}

export class ReactionBuzzerDisplay implements DisplayGameModule {
  id = "reaction-buzzer" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private combos = new Map<string, ComboTracker>();

  private roundIndex = 0;
  private targetTile = -1;
  private roundActive = false;
  private roundDeadline = 0;
  private nextRoundAt = 0;
  private answeredThisRound = false;
  private flashUntil = 0;
  private flashCorrect = true;

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
    this.roundIndex = 0;
    this.nextRoundAt = performance.now() + 900;
  }

  private layout(w: number, h: number): Layout {
    const pad = Math.min(w, h) * 0.08;
    const gridSize = Math.min(w, h) - pad * 2;
    const gap = gridSize * 0.05;
    const tileSize = (gridSize - gap * (GRID_SIZE - 1)) / GRID_SIZE;
    return { originX: (w - gridSize) / 2, originY: (h - gridSize) / 2, tileSize, gap };
  }

  private tileCenter(index: number, layout: Layout): { x: number; y: number } {
    const row = Math.floor(index / GRID_SIZE);
    const col = index % GRID_SIZE;
    return {
      x: layout.originX + col * (layout.tileSize + layout.gap) + layout.tileSize / 2,
      y: layout.originY + row * (layout.tileSize + layout.gap) + layout.tileSize / 2,
    };
  }

  private startRound(): void {
    this.roundIndex += 1;
    let tile = Math.floor(Math.random() * TILE_COUNT);
    if (tile === this.targetTile) tile = (tile + 1) % TILE_COUNT;
    this.targetTile = tile;
    this.roundActive = true;
    this.answeredThisRound = false;
    this.roundDeadline = performance.now() + ROUND_WINDOW_MS;
    sfx.roundStart();
  }

  private endRound(winnerId: string | null): void {
    this.roundActive = false;
    const now = performance.now();
    this.flashUntil = now + 260;
    this.flashCorrect = winnerId !== null;

    if (winnerId) {
      const combo = this.combos.get(winnerId);
      const streak = combo?.registerWin() ?? 1;
      const delta = Math.max(1, Math.round(combo?.multiplier ?? 1));
      const score = (this.scores.get(winnerId) ?? 0) + delta;
      this.scores.set(winnerId, score);
      this.gameCtx?.onScoreUpdate(winnerId, score);
      this.gameCtx?.sendPrivate(winnerId, { type: "reaction-result", correct: true });

      const canvas = this.stage?.canvas;
      const dpr = window.devicePixelRatio || 1;
      if (canvas) {
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        const { x, y } = this.tileCenter(this.targetTile, this.layout(w, h));
        this.particles.push(...spawnBurst(x, y, TILE_COLORS[this.targetTile % TILE_COLORS.length], 18));
        this.popups.push(spawnPopup(x, y, streak > 1 ? `+${delta} x${streak}` : `+${delta}`, "#ffffff"));
      }
      sfx.hit(streak - 1);
      if (streak > 1) sfx.comboTick(streak);
      triggerHitStop(this.hitStop, now, 40);
      triggerShake(this.shake, 4 + Math.min(streak, 4), 180);

      if (streak >= COMBO_REACTION_STREAK && this.gameCtx) {
        const name = this.gameCtx.players.find((p) => p.id === winnerId)?.name ?? "Someone";
        this.reactionGate.fire(this.gameCtx.hostSpeak, pickComboLine(name, streak));
      }

      // Winning a round doesn't mean everyone else's streak survives it — without this,
      // a streak only resets when a round times out with nobody winning, so two players
      // trading round wins back and forth both keep climbing the combo multiplier as if
      // each were on a run of consecutive wins.
      for (const [id, combo] of this.combos) {
        if (id !== winnerId) combo.registerMiss();
      }
    } else {
      for (const combo of this.combos.values()) combo.registerMiss();
      sfx.miss();
    }

    if (this.roundIndex >= ROUND_COUNT) {
      const canvas = this.stage?.canvas;
      const dpr = window.devicePixelRatio || 1;
      if (canvas) {
        this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, TILE_COLORS, 60));
      }
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
    if (msg.buttonId === String(this.targetTile)) {
      this.answeredThisRound = true;
      this.endRound(playerId);
    } else {
      this.gameCtx?.sendPrivate(playerId, { type: "reaction-result", correct: false });
    }
  }

  onPlayerLeave(playerId: string): void {
    this.scores.delete(playerId);
    this.combos.delete(playerId);
  }

  tick(dt: number): void {
    if (!this.ctx || !this.stage) return;
    const now = performance.now();

    if (!this.roundActive && this.roundIndex < ROUND_COUNT && now >= this.nextRoundAt) {
      this.startRound();
    }
    if (this.roundActive && now >= this.roundDeadline) {
      this.endRound(null);
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
      const { originX, originY, tileSize, gap } = this.layout(w, h);

      for (let i = 0; i < TILE_COUNT; i++) {
        const row = Math.floor(i / GRID_SIZE);
        const col = i % GRID_SIZE;
        const x = originX + col * (tileSize + gap);
        const y = originY + row * (tileSize + gap);

        const isTarget = this.roundActive && i === this.targetTile;
        ctx.globalAlpha = isTarget ? 1 : 0.28;
        ctx.fillStyle = TILE_COLORS[i % TILE_COLORS.length];
        roundRect(ctx, x, y, tileSize, tileSize, tileSize * 0.18);
        ctx.fill();
        drawSpecularEdge(ctx, x, y, tileSize, tileSize, tileSize * 0.18);

        if (isTarget) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 120);
          ctx.globalAlpha = 0.5 * pulse;
          ctx.lineWidth = 6;
          ctx.strokeStyle = "#ffffff";
          roundRect(ctx, x - 4, y - 4, tileSize + 8, tileSize + 8, tileSize * 0.2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      if (now < this.flashUntil) {
        ctx.fillStyle = this.flashCorrect ? "rgba(48,209,88,0.18)" : "rgba(255,55,95,0.18)";
        ctx.fillRect(0, 0, w, h);
      }

      drawParticles(ctx, this.particles, now);
      drawPopups(ctx, this.popups, now);

      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `600 ${Math.round(20 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`Round ${Math.min(this.roundIndex, ROUND_COUNT)} / ${ROUND_COUNT}`, w / 2, originY - 24 < 24 ? 24 : originY - 24);
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
    this.ctx = null;
  }
}
