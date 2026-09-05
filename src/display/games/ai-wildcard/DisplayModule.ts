import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage, WildcardMechanic } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { createStageCanvas } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx } from "@shared/audio";
import { NUMBER_GUESS_RANGE } from "@shared/wildcardConfig";
import { WILDCARD_MECHANICS, type RankedResult, type WildcardRoundData } from "./mechanics";

const ROUND_COUNT = 2;
const RULES_MS = 5500;
const WILDCARD_TIMEOUT_MS = 8000; // last-resort local fallback — the server itself always answers, even on total AI failure
const ACTIVE_MS = 15_000;
const RESULT_MS = 3500;
const THEME = THEMES["ai-wildcard"];

const RULES_LINES = [
  "Each round, an AI invents a brand-new mini-game on the spot.",
  "Vote, type, race to tap, or pick a side — whatever it comes up with.",
  "You'll find out the rules the same moment everyone else does.",
];

// Only reached if game:wildcard_result never arrives at all (a dropped message) — the
// server's getWildcard() already guarantees a reply, AI-generated or its own fallback.
const LOCAL_FALLBACK: { mechanic: WildcardMechanic; prompt: string; choices?: string[] } = {
  mechanic: "fast-tap",
  prompt: "Tap as fast as you can!",
};

type Phase = "rules" | "waiting_wildcard" | "active" | "result";
type Round = { mechanic: WildcardMechanic; prompt: string; choices?: string[] };

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

/** Generates this round's hidden target, client-side and never AI-authored (same precedent
 * aim's original targetHeading already established) — undefined for mechanics that don't
 * need one. */
function generateSecret(mechanic: WildcardMechanic): number | undefined {
  if (mechanic === "aim") return Math.floor(Math.random() * 360);
  if (mechanic === "number-guess") return Math.floor(Math.random() * (NUMBER_GUESS_RANGE + 1));
  return undefined;
}

export class AiWildcardDisplay implements DisplayGameModule {
  id = "ai-wildcard" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  private roundIndex = 0;
  private phase: Phase = "rules";
  private phaseDeadline = 0;
  private round: Round | null = null;
  private roundData: WildcardRoundData | null = null;
  private lastRoundResults: RankedResult[] = [];

  private particles: Particle[] = [];

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    for (const p of ctx.players) this.scores.set(p.id, 0);
    this.roundIndex = 0;
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
    if (this.roundIndex >= ROUND_COUNT || this.connectedPlayers().length < 2) {
      this.finishGame();
      return;
    }
    this.round = null;
    this.roundData = null;
    this.phase = "waiting_wildcard";
    this.phaseDeadline = performance.now() + WILDCARD_TIMEOUT_MS;
    this.gameCtx!.requestWildcard();
    sfx.uiTap();
  }

  private beginActive(round: Round): void {
    this.round = round;
    const secret = generateSecret(round.mechanic);
    this.roundData = { prompt: round.prompt, choices: round.choices, secret };
    WILDCARD_MECHANICS[round.mechanic].reset();

    const ctx = this.gameCtx!;
    const candidates = this.connectedPlayers().map((p) => ({ id: p.id, name: p.name }));
    for (const p of this.connectedPlayers()) {
      ctx.sendPrivate(p.id, {
        mechanic: round.mechanic,
        prompt: round.prompt,
        choices: round.choices,
        candidates,
        // Only aim's target is ever revealed to the controller (it needs the heading to
        // draw a compass) — number-guess's secret must never reach the phones guessing it.
        targetHeading: round.mechanic === "aim" ? secret : undefined,
      });
    }
    this.phase = "active";
    this.phaseDeadline = performance.now() + ACTIVE_MS;
    sfx.roundStart();
    ctx.hostSpeak(round.choices ? `${round.prompt} Your options: ${round.choices.join(", ")}.` : round.prompt);
  }

  onWildcardResult(round: { mechanic: WildcardMechanic; prompt: string; choices?: string[] }): void {
    if (this.phase !== "waiting_wildcard") return;
    this.beginActive(round);
  }

  private resolveRound(): void {
    const ctx = this.gameCtx!;
    const mechanic = this.round?.mechanic;
    this.lastRoundResults = mechanic ? WILDCARD_MECHANICS[mechanic].resolve(this.connectedPlayers(), this.roundData!) : [];

    for (const r of this.lastRoundResults) {
      const score = (this.scores.get(r.playerId) ?? 0) + r.points;
      this.scores.set(r.playerId, score);
      ctx.onScoreUpdate(r.playerId, score);
    }

    if (this.lastRoundResults.length > 0) sfx.hit(2);
    else sfx.miss();

    this.phase = "result";
    this.phaseDeadline = performance.now() + RESULT_MS;
    this.roundIndex += 1;
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

  onInput(playerId: string, msg: InputMessage): void {
    if (this.phase !== "active" || !this.connectedIds.has(playerId) || !this.round) return;
    WILDCARD_MECHANICS[this.round.mechanic].handleInput(playerId, msg);
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    for (const handler of Object.values(WILDCARD_MECHANICS)) handler.onPlayerLeave(playerId);
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    switch (this.phase) {
      case "rules":
        if (now >= this.phaseDeadline) this.startRound();
        break;
      case "waiting_wildcard":
        if (now >= this.phaseDeadline) this.beginActive(LOCAL_FALLBACK);
        break;
      case "active":
        if (now >= this.phaseDeadline) this.resolveRound();
        break;
      case "result":
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
      ctx.font = "700 30px -apple-system, sans-serif";
      ctx.fillText("🎲 AI Wildcard", w / 2, h * 0.22);
      ctx.font = "500 19px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => wrapText(ctx, line, w / 2, h * 0.4 + i * 46, w * 0.78, 26));
      return;
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "600 16px -apple-system, sans-serif";
    ctx.fillText(`Round ${Math.min(this.roundIndex + 1, ROUND_COUNT)} / ${ROUND_COUNT}`, w / 2, 28);

    if (this.phase === "waiting_wildcard") {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "700 24px -apple-system, sans-serif";
      const dots = ".".repeat((Math.floor(now / 400) % 3) + 1);
      ctx.fillText(`🎲 Inventing a mini-game${dots}`, w / 2, h * 0.45);
      return;
    }

    if (this.phase === "active" && this.round) {
      const handler = WILDCARD_MECHANICS[this.round.mechanic];
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = "600 15px -apple-system, sans-serif";
      ctx.fillText(handler.label, w / 2, h * 0.12);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "700 26px -apple-system, sans-serif";
      wrapText(ctx, this.round.prompt, w / 2, h * 0.24, w * 0.75, 32);
      if (this.round.choices) {
        ctx.font = "600 20px -apple-system, sans-serif";
        ctx.fillStyle = THEME.accent;
        wrapText(ctx, this.round.choices.join("  vs  "), w / 2, h * 0.38, w * 0.75, 26);
      }
      handler.drawExtra?.(ctx, w / 2, h * 0.36, w, h, this.roundData!, THEME.accent);
      const remaining = Math.max(0, this.phaseDeadline - now);
      ctx.font = "600 16px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(`${Math.ceil(remaining / 1000)}s`, w / 2, h * 0.46);

      const players = this.connectedPlayers();
      ctx.font = "600 15px -apple-system, sans-serif";
      players.forEach((p, i) => {
        const y = h * 0.58 + i * 28;
        const ready = handler.hasAnswered(p.id);
        ctx.fillStyle = ready ? "#30D158" : "rgba(255,255,255,0.5)";
        ctx.fillText(`${ready ? "✓" : "…"} ${p.name}`, w / 2, y);
      });
      return;
    }

    // result
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "700 24px -apple-system, sans-serif";
    ctx.fillText("Round results", w / 2, h * 0.14);
    if (this.lastRoundResults.length === 0) {
      ctx.font = "500 18px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("Nobody answered in time.", w / 2, h * 0.4);
    } else {
      const rowH = Math.min(80, (h * 0.65) / this.lastRoundResults.length);
      this.lastRoundResults.forEach((r, i) => {
        const y = h * 0.26 + i * rowH;
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "700 18px -apple-system, sans-serif";
        ctx.fillText(`#${r.rank}  ${this.nameFor(r.playerId)}`, w * 0.15, y);
        ctx.textAlign = "right";
        ctx.font = "700 18px -apple-system, sans-serif";
        ctx.fillStyle = THEME.accent;
        ctx.fillText(`+${r.points}`, w * 0.85, y);
      });
    }
    ctx.textAlign = "center";
    drawParticles(ctx, this.particles, now);
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
