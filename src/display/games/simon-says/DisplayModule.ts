import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import { createStageCanvas, roundRect, drawSpecularEdge } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { type ShakeState, createShakeState, triggerShake, withShake } from "../../game-runtime/shake";
import { type HitStopState, createHitStopState, effectiveDt, triggerHitStop } from "../../game-runtime/hitstop";
import { type Popup, drawPopups, spawnPopup, stepPopups } from "../../game-runtime/popupText";
import { ComboTracker } from "../../game-runtime/combo";
import { ReactionGate } from "../../game-runtime/leaderReactions";
import { pickComboLine } from "@shared/game-leader-lines";
import { playChime, sfx } from "@shared/audio";

const GRID_SIZE = 3;
const TILE_COUNT = GRID_SIZE * GRID_SIZE;
const ROUND_COUNT = 8;
const FLASH_ON_MS = 480;
const FLASH_GAP_MS = 220;
const BASE_INPUT_WINDOW_MS = 1600;
const INPUT_WINDOW_PER_STEP_MS = 650;
const ROUND_GAP_MS = 900;
const LONG_SEQUENCE_REACTION_LENGTH = 6;
const THEME = THEMES["simon-says"];

const TILE_COLORS = [
  "#FF375F", "#0A84FF", "#30D158", "#FFD60A", "#BF5AF2", "#FF9F0A", "#64D2FF", "#FF6482", "#5E5CE6",
];

// Index-matched to TILE_COLORS — a C-major scale across the grid. This pitch mapping is
// the actual mechanic classic Simon is built around, not decoration: the tile that flashes
// and the tile a player confirms should sound identical, so the ear confirms before the eye.
const TILE_FREQS = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33];

type Stage = "showing" | "input" | "gap";

interface Layout {
  originX: number;
  originY: number;
  tileSize: number;
  gap: number;
}

export class SimonSaysDisplay implements DisplayGameModule {
  id = "simon-says" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private combos = new Map<string, ComboTracker>();

  private sequence: number[] = [];
  private roundIndex = 0;
  private phase: Stage = "gap";
  private nextEventAt = 0;
  private showStepIndex = 0;
  private currentFlash = -1;
  private progress = new Map<string, number>();
  private eliminated = new Set<string>();
  private roundWinner: string | null = null;
  private flashUntil = 0;
  private flashGood = true;
  private wrongFlashUntil = 0;

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
    this.sequence = [];
    this.roundIndex = 0;
    this.nextEventAt = performance.now() + 900;
    this.phase = "gap";
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
    this.sequence.push(Math.floor(Math.random() * TILE_COUNT));
    this.progress.clear();
    this.eliminated.clear();
    this.roundWinner = null;
    this.phase = "showing";
    this.showStepIndex = 0;
    this.currentFlash = -1;
    this.nextEventAt = performance.now();
  }

  private advanceShowing(now: number): void {
    if (now < this.nextEventAt) return;
    if (this.currentFlash >= 0) {
      this.currentFlash = -1;
      this.nextEventAt = now + FLASH_GAP_MS;
      return;
    }
    if (this.showStepIndex >= this.sequence.length) {
      this.phase = "input";
      this.nextEventAt = now + BASE_INPUT_WINDOW_MS + this.sequence.length * INPUT_WINDOW_PER_STEP_MS;
      return;
    }
    this.currentFlash = this.sequence[this.showStepIndex];
    this.showStepIndex += 1;
    this.nextEventAt = now + FLASH_ON_MS;
    sfx.tone(TILE_FREQS[this.currentFlash]);
  }

  private endRound(winnerId: string | null): void {
    this.phase = "gap";
    const now = performance.now();
    this.flashUntil = now + 260;
    this.flashGood = winnerId !== null;

    if (winnerId) {
      const combo = this.combos.get(winnerId);
      const streak = combo?.registerWin() ?? 1;
      const delta = Math.max(1, Math.round(combo?.multiplier ?? 1));
      const score = (this.scores.get(winnerId) ?? 0) + delta;
      this.scores.set(winnerId, score);
      this.gameCtx?.onScoreUpdate(winnerId, score);

      const canvas = this.stage?.canvas;
      const dpr = window.devicePixelRatio || 1;
      if (canvas) {
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        this.particles.push(...spawnBurst(w / 2, h / 2, "#ffffff", 24, { speed: 200 }));
        const label = streak > 1 ? `+${delta} SEQUENCE! x${streak}` : `+${delta} SEQUENCE!`;
        this.popups.push(spawnPopup(w / 2, h / 2, label, "#ffffff"));
      }
      // A completed sequence is a bigger moment than one correct tile — a flourish, not a blip.
      playChime([523.25, 659.25, 783.99], { noteDuration: 0.1, gap: 0.03, gain: 0.26 });
      if (streak > 1) sfx.comboTick(streak);
      triggerHitStop(this.hitStop, now, 60);
      triggerShake(this.shake, 5, 200);

      if (this.sequence.length >= LONG_SEQUENCE_REACTION_LENGTH && this.gameCtx) {
        const name = this.gameCtx.players.find((p) => p.id === winnerId)?.name ?? "Someone";
        this.reactionGate.fire(this.gameCtx.hostSpeak, pickComboLine(name, this.sequence.length));
      }
    } else {
      for (const combo of this.combos.values()) combo.registerMiss();
    }

    if (this.roundIndex >= ROUND_COUNT) {
      const canvas = this.stage?.canvas;
      const dpr = window.devicePixelRatio || 1;
      if (canvas) this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, TILE_COLORS, 60));
      // Replay the final sequence as a triumphant arpeggio — a thematic capstone unique to this game.
      playChime(this.sequence.map((i) => TILE_FREQS[i]), { noteDuration: 0.11, gap: 0.02, gain: 0.3 });
      setTimeout(() => this.gameCtx?.onGameOver(this.getScores()), 1200);
      return;
    }
    this.nextEventAt = now + ROUND_GAP_MS;
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type !== "input:button" || !msg.pressed) return;
    if (this.phase !== "input") return;
    if (this.eliminated.has(playerId) || this.roundWinner) return;

    const expectedStep = this.progress.get(playerId) ?? 0;
    const expectedTile = this.sequence[expectedStep];
    if (msg.buttonId !== String(expectedTile)) {
      this.eliminated.add(playerId);
      this.wrongFlashUntil = performance.now() + 300;
      sfx.miss();
      this.gameCtx?.sendPrivate(playerId, { type: "reaction-result", correct: false });
      return;
    }

    // Confirm with the same pitch that played when this tile flashed — the core mechanic.
    sfx.tone(TILE_FREQS[expectedTile], { duration: 0.14, gain: 0.22 });
    this.gameCtx?.sendPrivate(playerId, { type: "reaction-result", correct: true });

    const nextStep = expectedStep + 1;
    if (nextStep >= this.sequence.length) {
      this.roundWinner = playerId;
      this.endRound(playerId);
      return;
    }
    this.progress.set(playerId, nextStep);
  }

  onPlayerLeave(playerId: string): void {
    this.scores.delete(playerId);
    this.combos.delete(playerId);
    this.progress.delete(playerId);
    this.eliminated.delete(playerId);
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    if (this.phase === "gap" && this.roundIndex < ROUND_COUNT && now >= this.nextEventAt) {
      this.startRound();
    } else if (this.phase === "showing") {
      this.advanceShowing(now);
    } else if (this.phase === "input" && now >= this.nextEventAt) {
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
    const accentOverride = this.currentFlash >= 0 ? TILE_COLORS[this.currentFlash] : undefined;
    drawAmbientBackground(ctx, w, h, THEME, now, accentOverride);

    withShake(ctx, this.shake, now, () => {
      const { originX, originY, tileSize, gap } = this.layout(w, h);

      for (let i = 0; i < TILE_COUNT; i++) {
        const { x, y } = this.tileCenter(i, { originX, originY, tileSize, gap });
        const drawX = x - tileSize / 2;
        const drawY = y - tileSize / 2;

        const isFlashing = this.phase === "showing" && i === this.currentFlash;
        ctx.globalAlpha = isFlashing ? 1 : 0.28;
        ctx.fillStyle = TILE_COLORS[i % TILE_COLORS.length];
        roundRect(ctx, drawX, drawY, tileSize, tileSize, tileSize * 0.18);
        ctx.fill();
        drawSpecularEdge(ctx, drawX, drawY, tileSize, tileSize, tileSize * 0.18);

        if (isFlashing) {
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 6;
          ctx.strokeStyle = "#ffffff";
          roundRect(ctx, drawX - 4, drawY - 4, tileSize + 8, tileSize + 8, tileSize * 0.2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      if (now < this.flashUntil) {
        ctx.fillStyle = this.flashGood ? "rgba(48,209,88,0.18)" : "rgba(255,55,95,0.18)";
        ctx.fillRect(0, 0, w, h);
      }
      if (now < this.wrongFlashUntil) {
        ctx.fillStyle = "rgba(255,55,95,0.32)";
        ctx.fillRect(0, 0, w, h);
      }

      drawParticles(ctx, this.particles, now);
      drawPopups(ctx, this.popups, now);

      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "600 20px -apple-system, sans-serif";
      ctx.textAlign = "center";
      const label = this.phase === "showing" ? "Watch closely…" : this.phase === "input" ? "Your turn!" : `Round ${Math.min(this.roundIndex, ROUND_COUNT)} / ${ROUND_COUNT}`;
      ctx.fillText(label, w / 2, originY - 24 < 24 ? 24 : originY - 24);
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
    this.ctx = null;
  }
}
