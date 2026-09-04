import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import { createStageCanvas } from "../../game-runtime/canvas";
import { drawReticle, drawTrail } from "../../game-runtime/reticle";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { type ShakeState, createShakeState, triggerShake, withShake } from "../../game-runtime/shake";
import { type HitStopState, createHitStopState, effectiveDt, triggerHitStop } from "../../game-runtime/hitstop";
import { type Popup, drawPopups, spawnPopup, stepPopups } from "../../game-runtime/popupText";
import { playNoiseBurst, playSweep, sfx } from "@shared/audio";

const GAME_DURATION_MS = 30_000;
const GRAVITY = 1.15; // fraction of height per second^2
const SPAWN_INTERVAL_MS = 750;
const BOMB_CHANCE = 0.14;
const SLICE_RADIUS = 0.15; // fraction of min(w,h) — the reticle IS the blade, generous contact zone
const FRUIT_SIZE = 0.11; // font size as a fraction of min(w,h) — was a fixed 38px, invisible on a big screen
const FRUIT_EMOJI = ["🍉", "🍊", "🍎", "🍇", "🍋", "🍓", "🥝"];
const CHAIN_WINDOW_MS = 400;
const THEME = THEMES["fruit-slice"];

interface FlyingItem {
  id: number;
  x: number; // 0..1 of stage width
  y: number; // 0..1 of stage height, 1 = bottom
  vy: number;
  isBomb: boolean;
  emoji: string;
  sliced: boolean;
  slicedAt: number;
}

interface Reticle {
  x: number;
  y: number;
  color: string;
  flashUntil: number;
  flashGood: boolean;
  trail: { x: number; y: number; t: number }[];
  lastHitAt: number;
  chain: number;
}

export class FruitSliceDisplay implements DisplayGameModule {
  id = "fruit-slice" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private items: FlyingItem[] = [];
  private nextId = 1;
  private lastSpawn = 0;
  private startedAt = 0;
  private ended = false;
  private scores = new Map<string, number>();
  private reticles = new Map<string, Reticle>();

  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake: ShakeState = createShakeState();
  private hitStop: HitStopState = createHitStopState();

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.items = [];
    this.scores.clear();
    this.reticles.clear();
    for (const p of ctx.players) {
      this.scores.set(p.id, 0);
      this.reticles.set(p.id, { x: 0.5, y: 0.5, color: p.color, flashUntil: 0, flashGood: true, trail: [], lastHitAt: 0, chain: 0 });
    }
    this.startedAt = performance.now();
    this.lastSpawn = 0;
    this.ended = false;
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type !== "input:pointer") return;
    const r = this.reticles.get(playerId);
    if (r) {
      r.x = msg.x;
      r.y = msg.y;
    }
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  onPlayerLeave(playerId: string): void {
    this.scores.delete(playerId);
    this.reticles.delete(playerId);
  }

  /** No swipe gesture required — the blade is wherever your reticle is, continuously. */
  private checkContact(scale: number, w: number, h: number): void {
    const now = performance.now();
    const radius = SLICE_RADIUS * scale;

    for (const [playerId, r] of this.reticles) {
      const px = r.x * w;
      const py = r.y * h;
      // .filter, not .find — lets every fruit overlapping the blade in one pass register,
      // not just the first, so simultaneous multi-fruit slices actually chain together.
      const hits = this.items.filter(
        (it) => !it.sliced && it.y > 0.04 && it.y < 0.96 && Math.hypot(it.x * w - px, it.y * h - py) < radius,
      );
      if (hits.length === 0) continue;

      r.flashUntil = now + 220;
      const hitBomb = hits.some((it) => it.isBomb);
      r.flashGood = !hitBomb;

      if (hitBomb) {
        r.chain = 0;
        for (const it of hits) {
          it.sliced = true;
          it.slicedAt = now;
        }
        const score = Math.max(0, (this.scores.get(playerId) ?? 0) - 1);
        this.scores.set(playerId, score);
        this.gameCtx?.onScoreUpdate(playerId, score);
        this.gameCtx?.sendPrivate(playerId, { type: "slice-result", bomb: true });
        this.particles.push(...spawnBurst(px, py, "#3a3a3a", 20, { speed: 160, kind: "spark" }));
        this.popups.push(spawnPopup(px, py, "BOOM", "#FF375F"));
        playNoiseBurst({ duration: 0.35, gain: 0.35, filterFreq: 300 });
        triggerHitStop(this.hitStop, now, 80);
        triggerShake(this.shake, 10, 260);
        continue;
      }

      r.chain = now - r.lastHitAt < CHAIN_WINDOW_MS ? r.chain + hits.length : hits.length;
      r.lastHitAt = now;

      for (const it of hits) {
        it.sliced = true;
        it.slicedAt = now;
        this.particles.push(...spawnBurst(it.x * w, it.y * h, "#ffffff", 10, { speed: 130, kind: "splat" }));
      }
      const score = (this.scores.get(playerId) ?? 0) + hits.length;
      this.scores.set(playerId, score);
      this.gameCtx?.onScoreUpdate(playerId, score);
      this.gameCtx?.sendPrivate(playerId, { type: "slice-result", bomb: false });
      if (r.chain > 1) this.popups.push(spawnPopup(px, py, `x${r.chain}`, r.color));
      playSweep({ fromFreq: 700, toFreq: 1400, duration: 0.1, type: "sine", gain: 0.16 });
      if (r.chain > 1) sfx.comboTick(r.chain);
      triggerHitStop(this.hitStop, now, 25);
      triggerShake(this.shake, 2 + Math.min(r.chain, 3), 100);
    }
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();
    const canvas = this.stage.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const scale = Math.max(1, Math.min(w, h));
    const physicsDt = effectiveDt(this.hitStop, now, dt);

    // Gates game *progression* only, not particles/draw below — ending the round still
    // needs several more frames to actually paint the confetti burst it just spawned and
    // let it animate through the ~600ms before onGameOver fires. Returning early here used
    // to skip straight past draw() the instant `ended` flipped true, so the confetti was
    // computed but never painted and the screen just froze for that whole window.
    if (!this.ended) {
      if (now - this.lastSpawn > SPAWN_INTERVAL_MS) {
        this.lastSpawn = now;
        this.items.push({
          id: this.nextId++,
          x: 0.14 + Math.random() * 0.72,
          y: 1.08,
          vy: -(0.85 + Math.random() * 0.25),
          isBomb: Math.random() < BOMB_CHANCE,
          emoji: FRUIT_EMOJI[Math.floor(Math.random() * FRUIT_EMOJI.length)],
          sliced: false,
          slicedAt: 0,
        });
      }

      for (const it of this.items) {
        if (it.sliced) continue;
        it.vy += GRAVITY * physicsDt;
        it.y += it.vy * physicsDt;
      }
      this.items = this.items.filter((it) => (it.sliced ? now - it.slicedAt < 260 : it.y < 1.18));

      for (const r of this.reticles.values()) {
        r.trail.push({ x: r.x * w, y: r.y * h, t: now });
        if (r.trail.length > 10) r.trail.shift();
      }

      this.checkContact(scale, w, h);

      if (now - this.startedAt >= GAME_DURATION_MS) {
        this.ended = true;
        this.particles.push(...spawnConfetti(w, h, ["#30D158", "#FFD60A", "#FF375F"], 60));
        sfx.gameOverFanfare();
        setTimeout(() => this.gameCtx?.onGameOver(this.getScores()), 600);
      }
    }

    this.particles = stepParticles(this.particles, physicsDt, now);
    this.popups = stepPopups(this.popups, now);

    this.draw(now, w, h, scale);
  }

  private draw(now: number, w: number, h: number, scale: number): void {
    const ctx = this.stage!.ctx;

    ctx.clearRect(0, 0, w, h);
    drawAmbientBackground(ctx, w, h, THEME, now);

    withShake(ctx, this.shake, now, () => {
      for (const r of this.reticles.values()) drawTrail(ctx, r.trail, r.color, now);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const it of this.items) {
        const cx = it.x * w;
        const cy = it.y * h;
        ctx.globalAlpha = it.sliced ? Math.max(0, 1 - (now - it.slicedAt) / 260) : 1;
        const size = FRUIT_SIZE * scale * (it.sliced ? 1.25 : 1);
        ctx.font = `${size}px serif`;
        ctx.fillText(it.isBomb ? "💣" : it.emoji, cx, cy);
      }
      ctx.globalAlpha = 1;
      ctx.textBaseline = "alphabetic";

      for (const r of this.reticles.values()) {
        const flashing = now < r.flashUntil;
        drawReticle(ctx, r.x * w, r.y * h, flashing && !r.flashGood ? "#FF375F" : r.color, scale, flashing);
      }

      drawParticles(ctx, this.particles, now);
      drawPopups(ctx, this.popups, now);

      const remaining = Math.max(0, GAME_DURATION_MS - (now - this.startedAt));
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "600 20px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.ceil(remaining / 1000)}s`, w / 2, 32);
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
