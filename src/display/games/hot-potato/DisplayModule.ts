import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { createStageCanvas, roundRect, drawSpecularEdge, uiScale, wrapText } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx, playNoiseBurst } from "@shared/audio";
import { ReactionGate } from "../../game-runtime/leaderReactions";
import { pickCloseCallLine } from "@shared/game-leader-lines";

const RULES_MS = 5500;
const ROUND_COUNT = 5;
// The fuse length is randomized *and hidden from players* — that's the entire tension of
// the game. Showing a countdown would turn "shake it before it blows" into "watch a timer."
const MIN_FUSE_MS = 6000;
const MAX_FUSE_MS = 13000;
const PASS_COOLDOWN_MS = 500; // one hard shake shouldn't double-pass in the same motion
const LAST_SECOND_PASS_MS = 1200; // the Display knows the hidden deadline even though players don't — a pass landing this close to it is a real "phew" moment
const REVEAL_MS = 2200;
const THEME = THEMES["hot-potato"];

const RULES_LINES = [
  "One random player starts holding the potato — a hidden fuse is already ticking.",
  "Shake your phone hard to pass it to a random other player.",
  "Whoever's holding it when the fuse runs out scores nothing that round.",
];

type Phase = "rules" | "holding" | "reveal";

export class HotPotatoDisplay implements DisplayGameModule {
  id = "hot-potato" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  private roundIndex = 0;
  private holderId: string | null = null;
  private lastPassAt = 0;
  private passCount = 0;
  private reactionGate = new ReactionGate();

  private phase: Phase = "rules";
  private phaseDeadline = 0;
  private lastExplodedId: string | null = null;

  private particles: Particle[] = [];

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    for (const p of ctx.players) this.scores.set(p.id, 0);
    this.roundIndex = 0;
    this.holderId = null;
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
    this.roundIndex++;
    if (this.roundIndex > ROUND_COUNT || this.connectedPlayers().length < 2) {
      this.finishGame();
      return;
    }
    const players = this.connectedPlayers();
    this.holderId = players[Math.floor(Math.random() * players.length)].id;
    this.passCount = 0;
    this.phase = "holding";
    this.phaseDeadline = performance.now() + MIN_FUSE_MS + Math.random() * (MAX_FUSE_MS - MIN_FUSE_MS);
    this.notifyHolder();
    sfx.roundStart();
  }

  private notifyHolder(): void {
    const ctx = this.gameCtx!;
    for (const p of this.connectedPlayers()) {
      ctx.sendPrivate(p.id, { holding: p.id === this.holderId });
    }
  }

  private passPotato(): void {
    const others = this.connectedPlayers().filter((p) => p.id !== this.holderId);
    if (others.length === 0) return; // last player standing this round — nobody to pass to
    const passer = this.gameCtx!.players.find((p) => p.id === this.holderId);
    this.holderId = others[Math.floor(Math.random() * others.length)].id;
    this.passCount++;
    this.notifyHolder();
    sfx.uiTap();

    if (this.stage) {
      const canvas = this.stage.canvas;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      this.particles.push(...spawnBurst(w / 2, h * 0.42, passer?.color ?? THEME.accent, 12, { speed: 130, life: 360 }));
    }
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (this.phase !== "holding" || msg.type !== "input:tap" || playerId !== this.holderId) return;
    const now = performance.now();
    if (now - this.lastPassAt < PASS_COOLDOWN_MS) return;
    this.lastPassAt = now;
    // The Display knows the hidden fuse deadline even though players never see it — a
    // pass landing this close to it is a real "phew, just in time" moment worth a reaction.
    if (this.phaseDeadline - now < LAST_SECOND_PASS_MS && this.gameCtx) {
      this.reactionGate.fire(this.gameCtx.hostSpeak, pickCloseCallLine());
    }
    this.passPotato();
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    // Deliberately NOT this.scores.delete(playerId) — every sibling game leaves a leaving
    // player's already-earned score in place so getScores() still credits it; deleting it
    // here wiped out however many rounds they'd already survived the instant they left.
    if (playerId === this.holderId && this.phase === "holding") this.passPotato();
  }

  private explode(): void {
    const ctx = this.gameCtx!;
    this.lastExplodedId = this.holderId;
    for (const p of this.connectedPlayers()) {
      if (p.id !== this.holderId) {
        const score = (this.scores.get(p.id) ?? 0) + 1;
        this.scores.set(p.id, score);
        ctx.onScoreUpdate(p.id, score);
      }
    }
    for (const p of this.connectedPlayers()) {
      ctx.sendPrivate(p.id, { holding: false, exploded: true, loserId: this.holderId });
    }

    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    this.particles.push(...spawnBurst(w / 2, h * 0.45, "#3a2a1a", 26, { speed: 220, kind: "spark" }));
    playNoiseBurst({ duration: 0.4, gain: 0.4, filterFreq: 280 });

    this.phase = "reveal";
    this.phaseDeadline = performance.now() + REVEAL_MS;
  }

  private finishGame(): void {
    const ctx = this.gameCtx!;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const colors = this.connectedPlayers().map((p) => p.color);
    this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, colors.length ? colors : [THEME.accent], 70));
    sfx.gameOverFanfare();
    setTimeout(() => ctx.onGameOver(this.getScores()), 900);
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    switch (this.phase) {
      case "rules":
        if (now >= this.phaseDeadline) this.startRound();
        break;
      case "holding":
        if (now >= this.phaseDeadline) this.explode();
        break;
      case "reveal":
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
      ctx.fillText("🥔 Hot Potato", w / 2, h * 0.25);
      ctx.font = `500 ${Math.round(19 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => wrapText(ctx, line, w / 2, h * 0.42 + i * 46, w * 0.78, 26));
      return;
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `600 ${Math.round(15 * uiScale(w, h))}px -apple-system, sans-serif`;
    ctx.fillText(`Round ${Math.min(this.roundIndex, ROUND_COUNT)} / ${ROUND_COUNT}`, w / 2, 26);

    // A pulsing potato that gets faster with each pass this round — a *felt* sense of
    // rising tension without ever revealing the actual hidden fuse remaining.
    const pulseSpeed = 180 - Math.min(120, this.passCount * 12);
    const pulse = 0.7 + 0.3 * Math.sin(now / pulseSpeed);
    ctx.font = `${Math.round(90 * pulse * uiScale(w, h))}px sans-serif`;
    ctx.fillText("🥔", w / 2, h * 0.42);

    if (this.phase === "holding" && this.holderId) {
      const holderColor = this.gameCtx!.players.find((p) => p.id === this.holderId)?.color ?? THEME.accent;
      const cardW = Math.min(w * 0.68, 460 * uiScale(w, h));
      const cardH = 108 * uiScale(w, h);
      const cardX = w / 2 - cardW / 2;
      const cardY = h * 0.565;
      ctx.save();
      roundRect(ctx, cardX, cardY, cardW, cardH, 22);
      ctx.fillStyle = "rgba(20,16,26,0.55)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `${holderColor}66`;
      ctx.stroke();
      drawSpecularEdge(ctx, cardX, cardY, cardW, cardH, 22, 0.28);
      ctx.restore();

      // Nameplate: a small colored pill behind the holder's name, matching how other
      // games present player identity (avatar-adjacent colored tag) rather than plain text.
      ctx.font = `700 ${Math.round(15 * uiScale(w, h))}px -apple-system, sans-serif`;
      const nameText = this.nameFor(this.holderId);
      const nameW = ctx.measureText(nameText).width;
      const pillW = nameW + 34;
      const pillH = 30;
      const pillX = w / 2 - pillW / 2;
      const pillY = cardY + 20;
      ctx.save();
      roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fillStyle = holderColor;
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#0a0a0f";
      ctx.textBaseline = "middle";
      ctx.fillText(nameText, w / 2, pillY + pillH / 2 + 1);
      ctx.textBaseline = "alphabetic";

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `600 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText("is holding it!", w / 2, cardY + 68);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = `600 ${Math.round(15 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText("Shake to pass!", w / 2, cardY + 92);
    } else if (this.phase === "reveal" && this.lastExplodedId) {
      ctx.fillStyle = "#FF453A";
      ctx.font = `700 ${Math.round(28 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText(`💥 ${this.nameFor(this.lastExplodedId)} got caught holding it!`, w / 2, h * 0.62);
    }

    drawParticles(ctx, this.particles, now);
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
