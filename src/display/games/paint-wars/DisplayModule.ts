import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import { createStageCanvas, drawSpecularEdge, roundRect, uiScale } from "../../game-runtime/canvas";
import { drawReticle } from "../../game-runtime/reticle";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { spawnConfetti, spawnBurst, stepParticles, drawParticles, type Particle } from "../../game-runtime/particles";
import { playTone, sfx } from "@shared/audio";

const GAME_DURATION_MS = 35_000;
const GRID_COLS = 32;
const GRID_ROWS = 18;
const PAINT_RADIUS_CELLS = 1.3;
const CLAIM_SOUND_COOLDOWN_MS = 150;
const CELL_FLASH_MS = 180;
// A real two-finger spread gesture (see controller/input/pinch.ts) temporarily widens a
// player's claim radius — a skill-timed player action, not a random pickup. Enforced here
// too, not just client-side debounced, same defense-in-depth every other input already gets.
const PINCH_BOOST_RADIUS_BONUS = 0.9;
const PINCH_BOOST_DURATION_MS = 2500;
const PINCH_BOOST_COOLDOWN_MS = 4000;
const THEME = THEMES["paint-wars"];

interface Reticle {
  x: number;
  y: number;
  color: string;
}

function cellHash(col: number, row: number): number {
  const v = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export class PaintWarsDisplay implements DisplayGameModule {
  id = "paint-wars" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private startedAt = 0;
  private ended = false;
  private reticles = new Map<string, Reticle>();
  private ownerGrid: (string | null)[] = [];
  private lastCounts = new Map<string, number>();
  private cellFlashUntil = new Map<number, number>();
  private lastClaimSoundAt = new Map<string, number>();
  private boostActiveUntil = new Map<string, number>();
  private boostCooldownUntil = new Map<string, number>();
  private particles: Particle[] = [];

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.reticles.clear();
    this.lastCounts.clear();
    this.cellFlashUntil.clear();
    this.lastClaimSoundAt.clear();
    this.boostActiveUntil.clear();
    this.boostCooldownUntil.clear();
    for (const p of ctx.players) {
      this.reticles.set(p.id, { x: 0.5, y: 0.5, color: p.color });
      this.lastCounts.set(p.id, 0);
    }
    this.ownerGrid = new Array(GRID_COLS * GRID_ROWS).fill(null);
    this.startedAt = performance.now();
    this.ended = false;
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type === "input:pointer") {
      const r = this.reticles.get(playerId);
      if (r) {
        r.x = msg.x;
        r.y = msg.y;
      }
      return;
    }
    if (msg.type === "input:button" && msg.buttonId === "pinch-boost" && msg.pressed) {
      const now = performance.now();
      if ((this.boostCooldownUntil.get(playerId) ?? 0) > now) return; // on cooldown — a client-side spread spam doesn't just re-trigger it
      this.boostActiveUntil.set(playerId, now + PINCH_BOOST_DURATION_MS);
      this.boostCooldownUntil.set(playerId, now + PINCH_BOOST_COOLDOWN_MS);
      const r = this.reticles.get(playerId);
      if (r) {
        const canvas = this.stage?.canvas;
        const dpr = window.devicePixelRatio || 1;
        if (canvas) {
          const w = canvas.width / dpr;
          const h = canvas.height / dpr;
          this.particles.push(...spawnBurst(r.x * w, r.y * h, r.color, 16, { speed: 180 }));
        }
      }
      playTone({ freq: 660, duration: 0.12, type: "triangle", gain: 0.2 });
    }
  }

  onPlayerLeave(playerId: string): void {
    this.reticles.delete(playerId);
    this.lastCounts.delete(playerId);
    this.lastClaimSoundAt.delete(playerId);
    this.boostActiveUntil.delete(playerId);
    this.boostCooldownUntil.delete(playerId);
  }

  private paint(now: number): void {
    for (const [playerId, r] of this.reticles) {
      const boosted = (this.boostActiveUntil.get(playerId) ?? 0) > now;
      const radius = boosted ? PAINT_RADIUS_CELLS + PINCH_BOOST_RADIUS_BONUS : PAINT_RADIUS_CELLS;
      const cx = r.x * GRID_COLS;
      const cy = r.y * GRID_ROWS;
      const minCol = Math.max(0, Math.floor(cx - radius));
      const maxCol = Math.min(GRID_COLS - 1, Math.ceil(cx + radius));
      const minRow = Math.max(0, Math.floor(cy - radius));
      const maxRow = Math.min(GRID_ROWS - 1, Math.ceil(cy + radius));
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const dx = col + 0.5 - cx;
          const dy = row + 0.5 - cy;
          if (dx * dx + dy * dy > radius * radius) continue;
          const idx = row * GRID_COLS + col;
          const prevOwner = this.ownerGrid[idx];
          if (prevOwner === playerId) continue;
          this.ownerGrid[idx] = playerId;
          // Only flash/sound on an actual contest — taking a cell from another player —
          // not on claiming empty space, which happens constantly and would be spam.
          if (prevOwner !== null) {
            this.cellFlashUntil.set(idx, now + CELL_FLASH_MS);
            const lastSound = this.lastClaimSoundAt.get(playerId) ?? 0;
            if (now - lastSound > CLAIM_SOUND_COOLDOWN_MS) {
              this.lastClaimSoundAt.set(playerId, now);
              playTone({ freq: 520, duration: 0.04, type: "sine", gain: 0.09 });
            }
          }
        }
      }
    }
  }

  private broadcastScoresIfChanged(): void {
    const counts = new Map<string, number>();
    for (const playerId of this.reticles.keys()) counts.set(playerId, 0);
    for (const owner of this.ownerGrid) {
      if (owner && counts.has(owner)) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    for (const [playerId, count] of counts) {
      if (this.lastCounts.get(playerId) !== count) {
        this.lastCounts.set(playerId, count);
        this.gameCtx?.onScoreUpdate(playerId, count);
      }
    }
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.lastCounts) final[id] = s;
    return final;
  }

  tick(dt: number): void {
    if (!this.stage || this.ended) return;
    const now = performance.now();

    this.paint(now);
    this.broadcastScoresIfChanged();
    this.particles = stepParticles(this.particles, dt, now);

    if (now - this.startedAt >= GAME_DURATION_MS) {
      this.ended = true;
      const canvas = this.stage.canvas;
      const dpr = window.devicePixelRatio || 1;
      const colors = [...this.reticles.values()].map((r) => r.color);
      this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, colors.length ? colors : ["#9a9a92"], 60));
      sfx.gameOverFanfare();
      setTimeout(() => this.gameCtx?.onGameOver(this.getScores()), 600);
    }

    this.draw(now);
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

  private draw(now: number): void {
    const ctx = this.stage!.ctx;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const scale = Math.max(1, Math.min(w, h));
    const cellW = w / GRID_COLS;
    const cellH = h / GRID_ROWS;

    ctx.clearRect(0, 0, w, h);
    drawAmbientBackground(ctx, w, h, THEME, now);

    const colorByPlayer = new Map<string, string>();
    for (const [id, r] of this.reticles) colorByPlayer.set(id, r.color);

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = row * GRID_COLS + col;
        const owner = this.ownerGrid[idx];
        if (!owner) continue;
        ctx.fillStyle = colorByPlayer.get(owner) ?? "#444";
        ctx.globalAlpha = 0.42 + cellHash(col, row) * 0.24; // per-cell jitter — keeps the grid from reading perfectly flat
        ctx.fillRect(col * cellW + 1, row * cellH + 1, cellW - 2, cellH - 2);

        const flashUntil = this.cellFlashUntil.get(idx);
        if (flashUntil && now < flashUntil) {
          ctx.globalAlpha = 0.55 * ((flashUntil - now) / CELL_FLASH_MS);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(col * cellW + 1, row * cellH + 1, cellW - 2, cellH - 2);
        }
      }
    }
    ctx.globalAlpha = 1;

    drawParticles(ctx, this.particles, now);

    for (const [playerId, r] of this.reticles) {
      drawReticle(ctx, r.x * w, r.y * h, r.color, scale, false);
      if ((this.boostActiveUntil.get(playerId) ?? 0) > now) {
        const boostRadiusPx = (PAINT_RADIUS_CELLS + PINCH_BOOST_RADIUS_BONUS) * cellW;
        ctx.save();
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now / 60);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(r.x * w, r.y * h, boostRadiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    const remaining = Math.max(0, GAME_DURATION_MS - (now - this.startedAt));
    const timerLabel = `${Math.ceil(remaining / 1000)}s`;
    const timerFontSize = Math.round(20 * uiScale(w, h));
    ctx.font = `600 ${timerFontSize}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    this.drawHudBadge(ctx, w / 2, 32, timerLabel, timerFontSize);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(timerLabel, w / 2, 32);
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
