import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import { createStageCanvas, drawSpecularEdge, roundRect, uiScale } from "../../game-runtime/canvas";
import { drawReticle } from "../../game-runtime/reticle";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { type ShakeState, createShakeState, triggerShake, withShake } from "../../game-runtime/shake";
import { type HitStopState, createHitStopState, effectiveDt, triggerHitStop } from "../../game-runtime/hitstop";
import { type Popup, drawPopups, spawnPopup, stepPopups } from "../../game-runtime/popupText";
import { playSweep, playTone, sfx } from "@shared/audio";

const GAME_DURATION_MS = 30_000;
const TARGET_RADIUS = 0.045; // fraction of min(w,h)
const MAX_TARGETS = 4;
const SPAWN_INTERVAL_MS = 900;
const STREAK_WINDOW_MS = 1200;
const THEME = THEMES["laser-blaster"];

interface Target {
  id: number;
  x: number;
  y: number;
  bornAt: number;
}

interface Reticle {
  x: number;
  y: number;
  color: string;
  flashUntil: number;
}

interface Streak {
  count: number;
  lastHitAt: number;
}

export class LaserBlasterDisplay implements DisplayGameModule {
  id = "laser-blaster" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private targets: Target[] = [];
  private nextTargetId = 1;
  private lastSpawn = 0;
  private startedAt = 0;
  private ended = false;
  private scores = new Map<string, number>();
  private reticles = new Map<string, Reticle>();
  private streaks = new Map<string, Streak>();

  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake: ShakeState = createShakeState();
  private hitStop: HitStopState = createHitStopState();

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.targets = [];
    this.scores.clear();
    this.reticles.clear();
    this.streaks.clear();
    for (const p of ctx.players) {
      this.scores.set(p.id, 0);
      this.reticles.set(p.id, { x: 0.5, y: 0.5, color: p.color, flashUntil: 0 });
      this.streaks.set(p.id, { count: 0, lastHitAt: 0 });
    }
    this.startedAt = performance.now();
    this.lastSpawn = 0;
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
    if (msg.type === "input:tap") {
      this.tryHit(playerId);
    }
  }

  private tryHit(playerId: string): void {
    const r = this.reticles.get(playerId);
    if (!r || !this.stage) return;
    const canvas = this.stage.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const scale = Math.min(w, h);
    const px = r.x * w;
    const py = r.y * h;
    const now = performance.now();

    playSweep({ fromFreq: 900, toFreq: 220, duration: 0.09, gain: 0.16 }); // every tap gets a "pew" — whiffs feel responsive too

    const hitIndex = this.targets.findIndex((t) => Math.hypot(t.x * w - px, t.y * h - py) < TARGET_RADIUS * scale * 1.3);
    r.flashUntil = now + 120;
    if (hitIndex === -1) {
      playTone({ freq: 260, duration: 0.05, type: "square", gain: 0.1 }); // quiet, distinct "empty click"
      const streak = this.streaks.get(playerId);
      if (streak) streak.count = 0;
      return;
    }

    this.targets.splice(hitIndex, 1);

    const streak = this.streaks.get(playerId) ?? { count: 0, lastHitAt: 0 };
    streak.count = now - streak.lastHitAt < STREAK_WINDOW_MS ? streak.count + 1 : 1;
    streak.lastHitAt = now;
    this.streaks.set(playerId, streak);

    const delta = 1 + Math.min(streak.count - 1, 4);
    const score = (this.scores.get(playerId) ?? 0) + delta;
    this.scores.set(playerId, score);
    this.gameCtx?.onScoreUpdate(playerId, score);

    this.particles.push(...spawnBurst(px, py, "#FF9F0A", 14, { speed: 180, kind: "spark" }));
    if (streak.count > 1) this.popups.push(spawnPopup(px, py, `+${delta} x${streak.count}`, "#FF9F0A"));
    sfx.hit(streak.count - 1);
    triggerHitStop(this.hitStop, now, 35);
    triggerShake(this.shake, 3 + Math.min(streak.count, 4), 150);
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  onPlayerLeave(playerId: string): void {
    this.scores.delete(playerId);
    this.reticles.delete(playerId);
    this.streaks.delete(playerId);
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    // Gates game *progression* only, not particles/draw below — ending the round still
    // needs several more frames to actually paint the confetti burst it just spawned and
    // let it animate through the ~600ms before onGameOver fires. Returning early here used
    // to skip straight past draw() the instant `ended` flipped true, so the confetti was
    // computed but never painted and the screen just froze for that whole window.
    if (!this.ended) {
      if (now - this.lastSpawn > SPAWN_INTERVAL_MS && this.targets.length < MAX_TARGETS) {
        this.lastSpawn = now;
        this.targets.push({
          id: this.nextTargetId++,
          x: 0.12 + Math.random() * 0.76,
          y: 0.15 + Math.random() * 0.65,
          bornAt: now,
        });
      }

      if (now - this.startedAt >= GAME_DURATION_MS) {
        this.ended = true;
        const canvas = this.stage.canvas;
        const dpr = window.devicePixelRatio || 1;
        this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, ["#FF9F0A", "#FF375F", "#64D2FF"], 60));
        sfx.gameOverFanfare();
        setTimeout(() => this.gameCtx?.onGameOver(this.getScores()), 600);
      }
    }

    const physicsDt = effectiveDt(this.hitStop, now, dt);
    this.particles = stepParticles(this.particles, physicsDt, now);
    this.popups = stepPopups(this.popups, now);

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

    ctx.clearRect(0, 0, w, h);
    drawAmbientBackground(ctx, w, h, THEME, now);

    withShake(ctx, this.shake, now, () => {
      for (const t of this.targets) {
        const age = now - t.bornAt;
        const pulse = 1 + 0.08 * Math.sin(age / 160);
        ctx.beginPath();
        ctx.fillStyle = "#FF9F0A";
        ctx.arc(t.x * w, t.y * h, TARGET_RADIUS * scale * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 3;
        ctx.arc(t.x * w, t.y * h, TARGET_RADIUS * scale * pulse * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const r of this.reticles.values()) {
        drawReticle(ctx, r.x * w, r.y * h, r.color, scale, now < r.flashUntil);
      }

      drawParticles(ctx, this.particles, now);
      drawPopups(ctx, this.popups, now);

      const remaining = Math.max(0, GAME_DURATION_MS - (now - this.startedAt));
      const timerLabel = `${Math.ceil(remaining / 1000)}s`;
      const timerFontSize = Math.round(20 * uiScale(w, h));
      ctx.font = `600 ${timerFontSize}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      this.drawHudBadge(ctx, w / 2, 32, timerLabel, timerFontSize);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(timerLabel, w / 2, 32);
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
