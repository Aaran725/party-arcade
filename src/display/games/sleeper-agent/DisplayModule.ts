import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { drawWordEntries, type WordEntry } from "@shared/word-bank";
import { createStageCanvas, roundRect, drawSpecularEdge } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { type ShakeState, createShakeState, triggerShake, withShake } from "../../game-runtime/shake";
import { type Popup, drawPopups, stepPopups } from "../../game-runtime/popupText";
import { sfx } from "@shared/audio";

const ROUND_COUNT = 3;
const RULES_MS = 7000;
const DISCUSSION_MS = 45_000;
const VOTE_MS = 20_000;
const RESOLUTION_MS = 2600;
const REDEMPTION_MS = 10_000;
const BETWEEN_ROUNDS_MS = 2200;
const CIVILIAN_CATCH_BONUS = 10;
const AGENT_ESCAPE_BONUS = 15;
const REDEMPTION_BONUS = 5;
const THEME = THEMES["sleeper-agent"];

const RULES_LINES = [
  "One player is secretly the Agent.",
  "Civilians know the word. The Agent only knows the category.",
  "Discuss out loud — don't say the word. Then vote for the Agent.",
  "Caught → civilians score. Not caught → the Agent scores.",
  "Either way, the Agent gets one final guess for bonus points.",
];

type Phase = "rules" | "discussion" | "voting" | "resolution" | "redemption" | "between";

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

export class SleeperAgentDisplay implements DisplayGameModule {
  id = "sleeper-agent" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  private roundIndex = 0;
  private agentId = "";
  private previousAgentId: string | null = null;
  private entry: WordEntry | null = null;
  private phase: Phase = "rules";
  private phaseDeadline = 0;
  private votes = new Map<string, string>();
  private agentCaught = false;
  private redemptionChoices: string[] = [];
  private redemptionResult: boolean | null = null;
  private resultFlash: string | null = null;
  private lastCountdownTickAt = 0;

  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake: ShakeState = createShakeState();

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    for (const p of ctx.players) this.scores.set(p.id, 0);
    this.roundIndex = 0;
    this.previousAgentId = null;
    this.phase = "rules";
    this.phaseDeadline = performance.now() + RULES_MS;
  }

  private connectedPlayers(): PlayerInfo[] {
    return this.gameCtx!.players.filter((p) => this.connectedIds.has(p.id));
  }

  private startRound(): void {
    const ctx = this.gameCtx!;
    const pool = this.connectedPlayers();
    if (pool.length < 2) {
      this.finishGame();
      return;
    }
    this.roundIndex++;
    const candidates = pool.length > 1 ? pool.filter((p) => p.id !== this.previousAgentId) : pool;
    this.agentId = candidates[Math.floor(Math.random() * candidates.length)].id;
    this.previousAgentId = this.agentId;
    this.entry = drawWordEntries(1)[0];
    this.votes.clear();
    this.agentCaught = false;
    this.redemptionResult = null;
    this.resultFlash = null;

    for (const p of pool) {
      ctx.sendPrivate(
        p.id,
        p.id === this.agentId
          ? { phase: "reveal", role: "agent", category: this.entry.category }
          : { phase: "reveal", role: "civilian", word: this.entry.word, category: this.entry.category },
      );
    }

    this.phase = "discussion";
    this.phaseDeadline = performance.now() + DISCUSSION_MS;
    this.lastCountdownTickAt = 0;
    sfx.roundStart();
  }

  private beginVoting(): void {
    const ctx = this.gameCtx!;
    const roster = this.connectedPlayers().map((p) => ({ id: p.id, name: p.name, color: p.color }));
    for (const p of this.connectedPlayers()) {
      ctx.sendPrivate(p.id, { phase: "vote", players: roster });
    }
    this.phase = "voting";
    this.phaseDeadline = performance.now() + VOTE_MS;
  }

  private resolveVote(): void {
    const counts = new Map<string, number>();
    for (const targetId of this.votes.values()) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
    let maxCount = 0;
    let leaders: string[] = [];
    for (const [id, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        leaders = [id];
      } else if (count === maxCount) {
        leaders.push(id);
      }
    }
    // A tie, or nobody voting the Agent, both favor the Agent — matches the real
    // Spyfall convention that an inconclusive vote lets the spy escape.
    this.agentCaught = leaders.length === 1 && leaders[0] === this.agentId;

    const ctx = this.gameCtx!;
    if (this.agentCaught) {
      for (const p of this.connectedPlayers()) {
        if (p.id === this.agentId) continue;
        const score = (this.scores.get(p.id) ?? 0) + CIVILIAN_CATCH_BONUS;
        this.scores.set(p.id, score);
        ctx.onScoreUpdate(p.id, score);
      }
      this.resultFlash = "Agent caught!";
      sfx.hit(2);
    } else {
      const score = (this.scores.get(this.agentId) ?? 0) + AGENT_ESCAPE_BONUS;
      this.scores.set(this.agentId, score);
      ctx.onScoreUpdate(this.agentId, score);
      this.resultFlash = "Agent escaped!";
      sfx.miss();
    }

    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    triggerShake(this.shake, 6, 200);
    this.particles.push(...spawnBurst(canvas.width / dpr / 2, canvas.height / dpr / 2, this.agentCaught ? "#30D158" : "#FF453A", 30, { speed: 180 }));

    this.phase = "resolution";
    this.phaseDeadline = performance.now() + RESOLUTION_MS;
  }

  private beginRedemption(): void {
    const ctx = this.gameCtx!;
    this.redemptionChoices = shuffle([this.entry!.word, ...this.entry!.decoys]);
    if (this.connectedIds.has(this.agentId)) {
      ctx.sendPrivate(this.agentId, { phase: "redemption", choices: this.redemptionChoices });
      this.phase = "redemption";
      this.phaseDeadline = performance.now() + REDEMPTION_MS;
    } else {
      this.finalizeRound();
    }
  }

  private finalizeRound(): void {
    if (this.roundIndex >= ROUND_COUNT || this.connectedPlayers().length < 2) {
      this.finishGame();
      return;
    }
    this.phase = "between";
    this.phaseDeadline = performance.now() + BETWEEN_ROUNDS_MS;
  }

  private finishGame(): void {
    const ctx = this.gameCtx!;
    this.phase = "between";
    this.phaseDeadline = Infinity;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const colors = this.connectedPlayers().map((p) => p.color);
    this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, colors.length ? colors : ["#FF453A"], 60));
    sfx.gameOverFanfare();
    setTimeout(() => ctx.onGameOver(this.getScores()), 900);
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type !== "input:button" || !msg.pressed) return;
    if (this.phase === "voting") {
      if (playerId === msg.buttonId) return; // defensive — client already excludes self from the grid
      if (!this.connectedIds.has(playerId)) return;
      this.votes.set(playerId, msg.buttonId);
      return;
    }
    if (this.phase === "redemption" && playerId === this.agentId) {
      const idx = Number(msg.buttonId);
      const correct = this.redemptionChoices[idx] === this.entry!.word;
      this.redemptionResult = correct;
      if (correct) {
        const ctx = this.gameCtx!;
        const score = (this.scores.get(this.agentId) ?? 0) + REDEMPTION_BONUS;
        this.scores.set(this.agentId, score);
        ctx.onScoreUpdate(this.agentId, score);
        sfx.hit(3);
      } else {
        sfx.miss();
      }
      this.phase = "resolution"; // reuse the flash beat to show the redemption result briefly
      this.phaseDeadline = performance.now() + RESOLUTION_MS;
      this.resultFlash = correct ? "Correct guess! +5" : "Wrong guess.";
    }
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    this.votes.delete(playerId);
    if (playerId === this.agentId && (this.phase === "discussion" || this.phase === "voting")) {
      this.resultFlash = "Agent disconnected — skipping round";
      this.phase = "resolution";
      this.phaseDeadline = performance.now() + RESOLUTION_MS;
    }
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
      case "discussion":
        if (now >= this.phaseDeadline) this.beginVoting();
        else if (this.phaseDeadline - now <= 3000 && now - this.lastCountdownTickAt >= 1000) {
          this.lastCountdownTickAt = now;
          sfx.countdownTick(true);
        }
        break;
      case "voting":
        if (now >= this.phaseDeadline) this.resolveVote();
        break;
      case "resolution":
        if (now >= this.phaseDeadline) {
          if (this.redemptionResult !== null) this.finalizeRound();
          else this.beginRedemption();
        }
        break;
      case "redemption":
        if (now >= this.phaseDeadline) {
          this.redemptionResult = false;
          this.resultFlash = "Time's up.";
          this.phase = "resolution";
          this.phaseDeadline = now + RESOLUTION_MS;
        }
        break;
      case "between":
        if (now >= this.phaseDeadline) this.startRound();
        break;
    }

    this.particles = stepParticles(this.particles, dt, now);
    this.popups = stepPopups(this.popups, now);
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

    withShake(ctx, this.shake, now, () => {
      ctx.textAlign = "center";

      if (this.phase === "rules") {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "700 30px -apple-system, sans-serif";
        ctx.fillText("🕵️ Sleeper Agent", w / 2, h * 0.2);
        ctx.font = "500 19px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        RULES_LINES.forEach((line, i) => {
          wrapText(ctx, line, w / 2, h * 0.35 + i * 46, w * 0.75, 26);
        });
        drawParticles(ctx, this.particles, now);
        drawPopups(ctx, this.popups, now);
        return;
      }

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "600 16px -apple-system, sans-serif";
      ctx.fillText(`Round ${Math.min(this.roundIndex, ROUND_COUNT)} / ${ROUND_COUNT}`, w / 2, 28);

      if (this.phase === "discussion") {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "600 26px -apple-system, sans-serif";
        wrapText(ctx, `Category: ${this.entry?.category ?? ""}`, w / 2, h * 0.4, w * 0.8, 34);
        ctx.font = "500 18px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        wrapText(ctx, "Discuss out loud — figure out who's the Agent.", w / 2, h * 0.5, w * 0.7, 26);
        this.drawCountdown(ctx, w, h, now);
      } else if (this.phase === "voting") {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "600 26px -apple-system, sans-serif";
        ctx.fillText("Vote on your phone", w / 2, h * 0.35);
        this.drawCountdown(ctx, w, h, now);
        this.drawVoteTally(ctx, w, h);
      } else if (this.phase === "resolution") {
        ctx.fillStyle = this.agentCaught || this.redemptionResult ? "#30D158" : "#FF453A";
        ctx.font = "700 36px -apple-system, sans-serif";
        ctx.fillText(this.resultFlash ?? "", w / 2, h * 0.45);
      } else if (this.phase === "redemption") {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "600 24px -apple-system, sans-serif";
        ctx.fillText("Agent is choosing a final guess…", w / 2, h * 0.45);
      }

      drawParticles(ctx, this.particles, now);
      drawPopups(ctx, this.popups, now);
    });
  }

  private drawCountdown(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    const remaining = Math.max(0, this.phaseDeadline - now);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "600 20px -apple-system, sans-serif";
    ctx.fillText(`${Math.ceil(remaining / 1000)}s`, w / 2, h * 0.9);
  }

  private drawVoteTally(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const players = this.connectedPlayers();
    const cols = Math.min(4, players.length);
    // Proportional cap (was a flat 160px) and row spacing (was a flat 70px) — both now
    // actually scale with screen size instead of freezing on a big TV.
    const cellW = Math.min(w * 0.16, (w * 0.8) / Math.max(1, cols));
    const rowH = Math.max(70, h * 0.11);
    const startX = w / 2 - (cellW * cols) / 2;
    const y = h * 0.55;
    const counts = new Map<string, number>();
    for (const targetId of this.votes.values()) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);

    players.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * cellW + cellW / 2;
      const cy = y + row * rowH;
      const count = counts.get(p.id) ?? 0;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "600 15px -apple-system, sans-serif";
      ctx.fillText(p.name, x, cy - 22);
      ctx.fillStyle = p.color;
      roundRect(ctx, x - cellW / 2 + 10, cy - 8, cellW - 20, 16, 8);
      ctx.globalAlpha = 0.25 + Math.min(1, count / Math.max(1, players.length)) * 0.6;
      ctx.fill();
      drawSpecularEdge(ctx, x - cellW / 2 + 10, cy - 8, cellW - 20, 16, 8, 0.3);
      ctx.globalAlpha = 1;
      if (count > 0) {
        ctx.fillStyle = "#fff";
        ctx.font = "700 13px -apple-system, sans-serif";
        ctx.fillText(String(count), x, cy);
      }
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
