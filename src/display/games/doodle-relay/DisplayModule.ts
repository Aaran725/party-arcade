import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { drawWordEntries } from "@shared/word-bank";
import { createStageCanvas, drawSpecularEdge, roundRect, uiScale, wrapText } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { type Popup, drawPopups, spawnPopup, stepPopups } from "../../game-runtime/popupText";
import { sfx } from "@shared/audio";

const MAX_ROUNDS = 6;
const RULES_MS = 6500;
const ROUND_WINDOW_MS = 80_000;
const ROUND_GAP_MS = 1600;
const GUESSER_BASE_SCORE = 10;
const ARTIST_BONUS = 8;
const DOODLE_W = 1000;
const DOODLE_H = 750;
const THEME = THEMES["doodle-relay"];

const RULES_LINES = [
  "Each round, one player draws the word on their phone.",
  "Everyone else watches the big screen and shouts guesses out loud.",
  "Think you know it? Buzz in — the Artist confirms if you're right.",
  "Guess fast for more points. The Artist scores too when you get it.",
];

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function speedBonus(remainingMs: number, totalMs: number): number {
  if (remainingMs > totalMs * 0.6) return 3;
  if (remainingMs > totalMs * 0.3) return 2;
  return 1;
}

export class DoodleRelayDisplay implements DisplayGameModule {
  id = "doodle-relay" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  private doodleCanvas: HTMLCanvasElement;
  private doodleCtx: CanvasRenderingContext2D;
  private lastX = 0;
  private lastY = 0;
  private strokeHistory: { points: { x: number; y: number }[]; color: string; lineWidth: number }[] = [];

  private artistOrder: string[] = [];
  private artistPointer = 0;
  private roundTotal = 0;
  private roundIndex = 0;
  private roundActive = false;
  private nextRoundAt = 0;
  private currentArtistId = "";
  private word = "";
  private roundDeadline = 0;
  private buzzedPlayerId: string | null = null;
  private awaitingArbitration = false;
  private lastCountdownTickAt = 0;
  private rulesUntil = 0;

  private particles: Particle[] = [];
  private popups: Popup[] = [];

  constructor() {
    this.doodleCanvas = document.createElement("canvas");
    this.doodleCanvas.width = DOODLE_W;
    this.doodleCanvas.height = DOODLE_H;
    this.doodleCtx = this.doodleCanvas.getContext("2d")!;
  }

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    for (const p of ctx.players) this.scores.set(p.id, 0);
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    this.artistOrder = shuffle(ctx.players.map((p) => p.id));
    this.artistPointer = 0;
    this.roundTotal = Math.min(this.artistOrder.length, MAX_ROUNDS);
    this.roundIndex = 0;
    this.roundActive = false;
    this.rulesUntil = performance.now() + RULES_MS;
    this.nextRoundAt = this.rulesUntil + 300;
  }

  private connectedPlayers(): PlayerInfo[] {
    return this.gameCtx!.players.filter((p) => this.connectedIds.has(p.id));
  }

  private nameFor(id: string): string {
    return this.gameCtx!.players.find((p) => p.id === id)?.name ?? "Someone";
  }

  private pickNextArtist(): string | null {
    const n = this.artistOrder.length;
    for (let i = 0; i < n; i++) {
      const id = this.artistOrder[this.artistPointer % n];
      this.artistPointer++;
      if (this.connectedIds.has(id)) return id;
    }
    return null;
  }

  private startRound(): void {
    const artistId = this.pickNextArtist();
    if (!artistId || this.connectedPlayers().length < 2) {
      this.finishGame();
      return;
    }
    this.currentArtistId = artistId;
    this.roundIndex += 1;
    this.word = drawWordEntries(1)[0].word;
    this.doodleCtx.clearRect(0, 0, DOODLE_W, DOODLE_H);
    this.strokeHistory = [];
    // Every connected player gets a per-round role message, not just the Artist — this
    // is how a guesser's controller knows a fresh round started and its buzzer should
    // reset, since the app has no other per-round broadcast for this game.
    for (const p of this.connectedPlayers()) {
      this.gameCtx!.sendPrivate(p.id, p.id === artistId ? { role: "artist", word: this.word } : { role: "guesser" });
    }
    this.roundActive = true;
    this.buzzedPlayerId = null;
    this.awaitingArbitration = false;
    this.roundDeadline = performance.now() + ROUND_WINDOW_MS;
    this.lastCountdownTickAt = 0;
    sfx.roundStart();
  }

  private endRound(winnerId: string | null, remainingMs = 0): void {
    this.roundActive = false;
    const ctx = this.gameCtx!;
    const now = performance.now();
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    if (winnerId) {
      const bonus = speedBonus(remainingMs, ROUND_WINDOW_MS);
      const guesserScore = (this.scores.get(winnerId) ?? 0) + bonus * GUESSER_BASE_SCORE;
      this.scores.set(winnerId, guesserScore);
      ctx.onScoreUpdate(winnerId, guesserScore);

      if (this.connectedIds.has(this.currentArtistId)) {
        const artistScore = (this.scores.get(this.currentArtistId) ?? 0) + ARTIST_BONUS;
        this.scores.set(this.currentArtistId, artistScore);
        ctx.onScoreUpdate(this.currentArtistId, artistScore);
      }

      this.popups.push(spawnPopup(w / 2, h * 0.5, `${this.nameFor(winnerId)} got it!`, "#30D158"));
      sfx.hit(bonus);
      // Snapshot before anything clears the canvas — the drawing that got correctly
      // guessed is this game's own best "reveal" moment for the party recap.
      ctx.setHighlight(this.doodleCanvas.toDataURL("image/png"), `"${this.word}" — drawn by ${this.nameFor(this.currentArtistId)}, guessed by ${this.nameFor(winnerId)}`);
    } else {
      this.popups.push(spawnPopup(w / 2, h * 0.5, `Nobody got "${this.word}"`, "#FF9F0A"));
      sfx.miss();
    }

    if (this.roundIndex >= this.roundTotal) {
      this.finishGame();
      return;
    }
    this.nextRoundAt = now + ROUND_GAP_MS;
  }

  private finishGame(): void {
    const ctx = this.gameCtx!;
    this.roundActive = false;
    this.roundIndex = this.roundTotal; // stop tick() from starting another round
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const colors = this.connectedPlayers().map((p) => p.color);
    this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, colors.length ? colors : ["#30D158"], 60));
    sfx.gameOverFanfare();
    setTimeout(() => ctx.onGameOver(this.getScores()), 900);
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  private drawStroke(msg: Extract<InputMessage, { type: "input:draw" }>): void {
    const dctx = this.doodleCtx;

    if (msg.phase === "undo" || msg.phase === "clear") {
      if (msg.phase === "undo") this.strokeHistory.pop();
      else this.strokeHistory.length = 0;
      this.redrawDoodle();
      return;
    }

    const lineWidth = msg.lineWidth ?? 6;
    dctx.strokeStyle = msg.color;
    dctx.lineWidth = lineWidth;
    dctx.lineCap = "round";
    dctx.lineJoin = "round";

    if (msg.phase === "start") this.strokeHistory.push({ points: [], color: msg.color, lineWidth });
    const stroke = this.strokeHistory[this.strokeHistory.length - 1];

    if (msg.phase === "start" && msg.points[0]) {
      this.lastX = msg.points[0].x * DOODLE_W;
      this.lastY = msg.points[0].y * DOODLE_H;
      stroke?.points.push(msg.points[0]);
      dctx.beginPath();
      dctx.fillStyle = msg.color;
      dctx.arc(this.lastX, this.lastY, 3, 0, Math.PI * 2);
      dctx.fill();
    }

    const rest = msg.phase === "start" ? msg.points.slice(1) : msg.points;
    for (const pt of rest) {
      stroke?.points.push(pt);
      const x = pt.x * DOODLE_W;
      const y = pt.y * DOODLE_H;
      dctx.beginPath();
      dctx.moveTo(this.lastX, this.lastY);
      dctx.lineTo(x, y);
      dctx.stroke();
      this.lastX = x;
      this.lastY = y;
    }
  }

  /** Full repaint from stroke history — the only way to remove ink already committed to a raster canvas. */
  private redrawDoodle(): void {
    const dctx = this.doodleCtx;
    dctx.clearRect(0, 0, DOODLE_W, DOODLE_H);
    dctx.lineCap = "round";
    dctx.lineJoin = "round";
    for (const stroke of this.strokeHistory) {
      const [first] = stroke.points;
      if (!first) continue;
      dctx.strokeStyle = stroke.color;
      dctx.fillStyle = stroke.color;
      dctx.lineWidth = stroke.lineWidth;
      dctx.beginPath();
      dctx.arc(first.x * DOODLE_W, first.y * DOODLE_H, 3, 0, Math.PI * 2);
      dctx.fill();
      dctx.beginPath();
      stroke.points.forEach((pt, i) => {
        const x = pt.x * DOODLE_W;
        const y = pt.y * DOODLE_H;
        if (i === 0) dctx.moveTo(x, y);
        else dctx.lineTo(x, y);
      });
      dctx.stroke();
    }
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type === "input:draw") {
      if (playerId !== this.currentArtistId || !this.roundActive) return;
      this.drawStroke(msg);
      return;
    }
    if (msg.type !== "input:button" || !msg.pressed) return;

    if (this.roundActive && !this.awaitingArbitration && playerId !== this.currentArtistId && this.buzzedPlayerId === null) {
      this.buzzedPlayerId = playerId;
      this.awaitingArbitration = true;
      this.gameCtx!.sendPrivate(this.currentArtistId, { phase: "arbitrate", guesserName: this.nameFor(playerId) });
      sfx.uiTap();
      return;
    }

    if (this.awaitingArbitration && playerId === this.currentArtistId) {
      const correct = msg.buttonId === "correct";
      const remaining = Math.max(0, this.roundDeadline - performance.now());
      this.awaitingArbitration = false;
      if (correct) {
        this.endRound(this.buzzedPlayerId, remaining);
      } else {
        // Reopen for another guess within the same round. The Artist's canvas never
        // stopped existing (their controller now keeps it mounted under the arbitration
        // overlay instead of tearing it down), so it only needs telling to dismiss that
        // overlay — not a full round-start message, which would make it rebuild a blank
        // canvas from scratch. The wrongly-confirmed guesser's buzzer does need re-arming.
        const wrongGuesserId = this.buzzedPlayerId;
        this.buzzedPlayerId = null;
        this.gameCtx!.sendPrivate(this.currentArtistId, { phase: "resume" });
        if (wrongGuesserId && this.connectedIds.has(wrongGuesserId)) {
          this.gameCtx!.sendPrivate(wrongGuesserId, { role: "guesser" });
        }
      }
    }
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    if (playerId === this.currentArtistId && this.roundActive) {
      this.roundActive = false;
      this.doodleCtx.clearRect(0, 0, DOODLE_W, DOODLE_H);
      this.nextRoundAt = performance.now();
    } else if (playerId === this.buzzedPlayerId && this.awaitingArbitration) {
      this.buzzedPlayerId = null;
      this.awaitingArbitration = false;
    }
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    if (!this.roundActive && this.roundIndex < this.roundTotal && now >= this.nextRoundAt) {
      this.startRound();
    }
    if (this.roundActive && !this.awaitingArbitration) {
      const remaining = this.roundDeadline - now;
      if (remaining <= 3000 && now - this.lastCountdownTickAt >= 1000) {
        this.lastCountdownTickAt = now;
        sfx.countdownTick(true);
      }
      if (remaining <= 0) this.endRound(null);
    }

    this.particles = stepParticles(this.particles, dt, now);
    this.popups = stepPopups(this.popups, now);
    this.draw(now);
  }

  /** Small glass-chrome pill behind a centered HUD text label (round counter, status line, timer), matching the shared badge look used elsewhere for floating overlay text. `ctx.font`/`textAlign` must already be set for the label; draw the label itself right after this call. */
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

    ctx.clearRect(0, 0, w, h);
    drawAmbientBackground(ctx, w, h, THEME, now);

    if (now < this.rulesUntil) {
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `700 ${Math.round(30 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText("✏️ Doodle Relay", w / 2, h * 0.25);
      ctx.font = `500 ${Math.round(19 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => {
        wrapText(ctx, line, w / 2, h * 0.42 + i * 46, w * 0.75, 26);
      });
      return;
    }

    ctx.drawImage(this.doodleCanvas, 0, 0, DOODLE_W, DOODLE_H, 0, 0, w, h);

    const roundLabel = `Round ${Math.min(this.roundIndex, this.roundTotal)} / ${this.roundTotal}`;
    const roundFontSize = Math.round(16 * uiScale(w, h));
    ctx.font = `600 ${roundFontSize}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    this.drawHudBadge(ctx, w / 2, 28, roundLabel, roundFontSize);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(roundLabel, w / 2, 28);

    if (this.roundActive) {
      const artistName = this.nameFor(this.currentArtistId);
      const statusLabel = this.awaitingArbitration ? `${this.nameFor(this.buzzedPlayerId ?? "")} is guessing…` : `${artistName} is drawing…`;
      const statusFontSize = Math.round(20 * uiScale(w, h));
      ctx.font = `600 ${statusFontSize}px -apple-system, sans-serif`;
      this.drawHudBadge(ctx, w / 2, h - 30, statusLabel, statusFontSize);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(statusLabel, w / 2, h - 30);

      if (!this.awaitingArbitration) {
        const remaining = Math.max(0, this.roundDeadline - now);
        const timerLabel = `${Math.ceil(remaining / 1000)}s`;
        const timerFontSize = Math.round(18 * uiScale(w, h));
        ctx.font = `600 ${timerFontSize}px -apple-system, sans-serif`;
        this.drawHudBadge(ctx, w / 2, 54, timerLabel, timerFontSize);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillText(timerLabel, w / 2, 54);
      }
    }

    drawParticles(ctx, this.particles, now);
    drawPopups(ctx, this.popups, now);
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
