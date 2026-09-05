import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { drawWordEntries } from "@shared/word-bank";
import { createStageCanvas, uiScale, wrapText, roundRect, drawSpecularEdge } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx } from "@shared/audio";

const RULES_MS = 6500;
const TURN_MS = 12_000;
const TRANSCRIBING_TIMEOUT_MS = 8000;
const REVEAL_MS = 2200;
const MAX_TURNS = 40;
const POINTS_PER_WORD = 5; // scaled by chain length at the moment of success
const WINNER_BONUS = 25;
const THEME = THEMES["echo-chain"];

const RULES_LINES = [
  "One player at a time holds the mic button and says a word.",
  "Say anything new and the chain continues — repeat a word or freeze up and you're out.",
  "Last player standing wins.",
];

type Phase = "rules" | "turn" | "transcribing" | "reveal";
type Outcome = { type: "success"; playerId: string; word: string } | { type: "eliminated"; playerId: string; reason: "silence" | "repeat" };

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class EchoChainDisplay implements DisplayGameModule {
  id = "echo-chain" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();
  private eliminatedIds = new Set<string>();

  private chainWords: string[] = [];
  private turnOrder: string[] = [];
  private turnPointer = 0;
  private turnCount = 0;
  private currentPlayerId = "";
  private winnerId: string | null = null;
  private lastOutcome: Outcome | null = null;

  private phase: Phase = "rules";
  private phaseDeadline = 0;
  private lastCountdownTickAt = 0;

  private particles: Particle[] = [];

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    this.eliminatedIds.clear();
    for (const p of ctx.players) this.scores.set(p.id, 0);
    this.chainWords = [];
    this.turnOrder = shuffle(ctx.players.map((p) => p.id));
    this.turnPointer = 0;
    this.turnCount = 0;
    this.winnerId = null;
    this.lastOutcome = null;
    this.phase = "rules";
    this.phaseDeadline = performance.now() + RULES_MS;
  }

  private connectedPlayers(): PlayerInfo[] {
    return this.gameCtx!.players.filter((p) => this.connectedIds.has(p.id));
  }

  private remainingPlayers(): PlayerInfo[] {
    return this.connectedPlayers().filter((p) => !this.eliminatedIds.has(p.id));
  }

  private nameFor(id: string): string {
    return this.gameCtx!.players.find((p) => p.id === id)?.name ?? "Someone";
  }

  private beginChain(): void {
    this.chainWords = [drawWordEntries(1)[0].word];
    this.startTurn();
  }

  private pickNextPlayer(): string | null {
    const n = this.turnOrder.length;
    for (let i = 0; i < n; i++) {
      const id = this.turnOrder[this.turnPointer % n];
      this.turnPointer++;
      if (this.connectedIds.has(id) && !this.eliminatedIds.has(id)) return id;
    }
    return null;
  }

  private startTurn(): void {
    this.turnCount++;
    if (this.turnCount > MAX_TURNS) {
      this.finishGame();
      return;
    }
    const remaining = this.remainingPlayers();
    if (remaining.length <= 1) {
      this.winnerId = remaining[0]?.id ?? null;
      this.finishGame();
      return;
    }
    const nextId = this.pickNextPlayer();
    if (!nextId) {
      this.finishGame();
      return;
    }
    this.currentPlayerId = nextId;
    const ctx = this.gameCtx!;
    for (const p of this.connectedPlayers()) {
      if (this.eliminatedIds.has(p.id)) ctx.sendPrivate(p.id, { role: "eliminated" });
      else if (p.id === nextId) ctx.sendPrivate(p.id, { role: "active" });
      else ctx.sendPrivate(p.id, { role: "waiting", activeName: this.nameFor(nextId) });
    }
    this.phase = "turn";
    this.phaseDeadline = performance.now() + TURN_MS;
    this.lastCountdownTickAt = 0;
  }

  private resolveOutcome(outcome: Outcome): void {
    this.lastOutcome = outcome;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    if (outcome.type === "eliminated") {
      this.eliminatedIds.add(outcome.playerId);
      sfx.miss();
    } else {
      const points = POINTS_PER_WORD * this.chainWords.length;
      const score = (this.scores.get(outcome.playerId) ?? 0) + points;
      this.scores.set(outcome.playerId, score);
      this.gameCtx!.onScoreUpdate(outcome.playerId, score);
      const color = this.connectedPlayers().find((p) => p.id === outcome.playerId)?.color ?? THEME.accent;
      this.particles.push(...spawnBurst(w / 2, h * 0.42, color, 14, { speed: 160 }));
      sfx.hit(1);
    }

    this.phase = "reveal";
    this.phaseDeadline = performance.now() + REVEAL_MS;
  }

  private finishGame(): void {
    const ctx = this.gameCtx!;
    if (this.winnerId) {
      const score = (this.scores.get(this.winnerId) ?? 0) + WINNER_BONUS;
      this.scores.set(this.winnerId, score);
      ctx.onScoreUpdate(this.winnerId, score);
    }
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

  onTranscriptionResult(playerId: string, text: string | null): void {
    if (this.phase !== "transcribing" || playerId !== this.currentPlayerId) return;
    const normalized = (text ?? "").trim();
    if (!normalized) {
      this.resolveOutcome({ type: "eliminated", playerId, reason: "silence" });
      return;
    }
    const lower = normalized.toLowerCase();
    if (this.chainWords.some((w) => w.toLowerCase() === lower)) {
      this.resolveOutcome({ type: "eliminated", playerId, reason: "repeat" });
      return;
    }
    this.chainWords.push(normalized);
    this.resolveOutcome({ type: "success", playerId, word: normalized });
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type !== "input:audio") return;
    if (this.phase !== "turn" || playerId !== this.currentPlayerId) return;
    this.phase = "transcribing";
    this.phaseDeadline = performance.now() + TRANSCRIBING_TIMEOUT_MS;
    this.gameCtx!.requestTranscription(playerId, msg.audioData);
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    this.eliminatedIds.add(playerId);
    if (playerId === this.currentPlayerId && (this.phase === "turn" || this.phase === "transcribing")) {
      this.resolveOutcome({ type: "eliminated", playerId, reason: "silence" });
    }
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    switch (this.phase) {
      case "rules":
        if (now >= this.phaseDeadline) this.beginChain();
        break;
      case "turn": {
        const remaining = this.phaseDeadline - now;
        if (remaining <= 3000 && now - this.lastCountdownTickAt >= 1000) {
          this.lastCountdownTickAt = now;
          sfx.countdownTick(true);
        }
        if (remaining <= 0) this.resolveOutcome({ type: "eliminated", playerId: this.currentPlayerId, reason: "silence" });
        break;
      }
      case "transcribing":
        if (now >= this.phaseDeadline) this.resolveOutcome({ type: "eliminated", playerId: this.currentPlayerId, reason: "silence" });
        break;
      case "reveal":
        if (now >= this.phaseDeadline) this.startTurn();
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
      ctx.fillText("🗣️ Echo Chain", w / 2, h * 0.25);
      ctx.font = `500 ${Math.round(19 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => wrapText(ctx, line, w / 2, h * 0.42 + i * 46, w * 0.78, 26));
      return;
    }

    // Chain status header, shown in every in-game phase.
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `600 ${Math.round(15 * uiScale(w, h))}px -apple-system, sans-serif`;
    ctx.fillText(`${this.chainWords.length} word${this.chainWords.length === 1 ? "" : "s"} in the chain`, w / 2, 26);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `700 ${Math.round(34 * uiScale(w, h))}px -apple-system, sans-serif`;
    ctx.fillText(this.chainWords[this.chainWords.length - 1] ?? "", w / 2, h * 0.22);

    if (this.phase === "turn") {
      this.drawGlassPanel(ctx, w * 0.08, h * 0.09, w * 0.84, h * 0.4);
      ctx.fillStyle = THEME.accent;
      ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText(`${this.nameFor(this.currentPlayerId)}'s turn`, w / 2, h * 0.36);
      const remaining = Math.max(0, this.phaseDeadline - now);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `600 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText(`${Math.ceil(remaining / 1000)}s`, w / 2, h * 0.44);
    } else if (this.phase === "transcribing") {
      this.drawGlassPanel(ctx, w * 0.08, h * 0.09, w * 0.84, h * 0.34);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `700 ${Math.round(22 * uiScale(w, h))}px -apple-system, sans-serif`;
      const dots = ".".repeat((Math.floor(now / 400) % 3) + 1);
      ctx.fillText(`🎧 Listening${dots}`, w / 2, h * 0.4);
    } else if (this.phase === "reveal" && this.lastOutcome) {
      this.drawGlassPanel(ctx, w * 0.08, h * 0.09, w * 0.84, h * 0.32);
      if (this.lastOutcome.type === "success") {
        ctx.fillStyle = "#30D158";
        ctx.font = `700 ${Math.round(26 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillText(`✅ "${this.lastOutcome.word}"`, w / 2, h * 0.38);
      } else {
        ctx.fillStyle = "#FF453A";
        ctx.font = `700 ${Math.round(26 * uiScale(w, h))}px -apple-system, sans-serif`;
        const reason = this.lastOutcome.reason === "repeat" ? "repeated a word!" : "froze up!";
        ctx.fillText(`❌ ${this.nameFor(this.lastOutcome.playerId)} ${reason}`, w / 2, h * 0.38);
      }
    }

    // Roster strip along the bottom — green name = still in, dim/struck = eliminated.
    const players = this.connectedPlayers();
    const rowY = h * 0.9;
    ctx.font = `600 ${Math.round(14 * uiScale(w, h))}px -apple-system, sans-serif`;
    const gap = Math.min(140, w / Math.max(1, players.length));
    const startX = w / 2 - (gap * (players.length - 1)) / 2;
    players.forEach((p, i) => {
      const out = this.eliminatedIds.has(p.id);
      ctx.fillStyle = out ? "rgba(255,255,255,0.35)" : p.color;
      ctx.fillText(out ? `${p.name} ✗` : p.name, startX + i * gap, rowY);
    });

    drawParticles(ctx, this.particles, now);
  }

  /** A themed glass card behind this phase's content — matches the roundRect+drawSpecularEdge chrome the rest of the roster already uses, previously missing here since Echo Chain drew straight onto the ambient background. */
  private drawGlassPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const r = Math.min(w, h) * 0.08;
    ctx.fillStyle = "rgba(20,16,32,0.45)";
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    drawSpecularEdge(ctx, x, y, w, h, r, 0.22);
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
