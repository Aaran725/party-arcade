import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage, WildcardMechanic } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { createStageCanvas } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx } from "@shared/audio";

const ROUND_COUNT = 2;
const RULES_MS = 5500;
const WILDCARD_TIMEOUT_MS = 8000; // last-resort local fallback — the server itself always answers, even on total AI failure
const ACTIVE_MS = 15_000;
const RESULT_MS = 3500;
const POINTS_BY_RANK = [25, 15, 8];
const TYPE_PARTICIPATION_POINTS = 10; // "type" has no cheap way to judge quality without another AI call — everyone who answers gets the same credit
const THEME = THEMES["ai-wildcard"];

const RULES_LINES = [
  "Each round, an AI invents a brand-new mini-game on the spot.",
  "Vote, type, race to tap, or pick a side — whatever it comes up with.",
  "You'll find out the rules the same moment everyone else does.",
];

// Only reached if game:wildcard_result never arrives at all (a dropped message) — the
// server's getWildcard() already guarantees a reply, AI-generated or its own fallback.
const LOCAL_FALLBACK: { mechanic: WildcardMechanic; prompt: string; choices?: [string, string] } = {
  mechanic: "fast-tap",
  prompt: "Tap as fast as you can!",
};

type Phase = "rules" | "waiting_wildcard" | "active" | "result";
type Round = { mechanic: WildcardMechanic; prompt: string; choices?: [string, string] };

interface RankedResult {
  playerId: string;
  tally: number;
  rank: number;
  points: number;
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

function rankByTally(counts: { playerId: string; tally: number }[]): RankedResult[] {
  const sorted = [...counts].sort((a, b) => b.tally - a.tally);
  const results: RankedResult[] = [];
  let rank = 0;
  let prev: number | null = null;
  sorted.forEach((r, i) => {
    if (prev === null || r.tally !== prev) rank = i + 1;
    prev = r.tally;
    results.push({ playerId: r.playerId, tally: r.tally, rank, points: POINTS_BY_RANK[rank - 1] ?? 0 });
  });
  return results;
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

  private votes = new Map<string, string>(); // voter/chooser -> target playerId or "A"/"B"
  private tapOrder: string[] = [];
  private responses = new Map<string, string>();
  private aimLocked = new Map<string, number>(); // playerId -> the heading they locked in
  private targetHeading = 0;
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
    this.votes.clear();
    this.tapOrder = [];
    this.responses.clear();
    this.aimLocked.clear();
    this.targetHeading = Math.floor(Math.random() * 360); // Display-side, not AI-generated — the AI can't know real compass directions, same as it doesn't invent fast-tap's timing
    this.round = null;
    this.phase = "waiting_wildcard";
    this.phaseDeadline = performance.now() + WILDCARD_TIMEOUT_MS;
    this.gameCtx!.requestWildcard();
    sfx.uiTap();
  }

  private beginActive(round: Round): void {
    this.round = round;
    const ctx = this.gameCtx!;
    const candidates = this.connectedPlayers().map((p) => ({ id: p.id, name: p.name }));
    for (const p of this.connectedPlayers()) {
      ctx.sendPrivate(p.id, { mechanic: round.mechanic, prompt: round.prompt, choices: round.choices, candidates, targetHeading: this.targetHeading });
    }
    this.phase = "active";
    this.phaseDeadline = performance.now() + ACTIVE_MS;
    sfx.roundStart();
    ctx.hostSpeak(round.choices ? `${round.prompt} Would you rather ${round.choices[0]}, or ${round.choices[1]}?` : round.prompt);
  }

  onWildcardResult(round: { mechanic: WildcardMechanic; prompt: string; choices?: [string, string] }): void {
    if (this.phase !== "waiting_wildcard") return;
    this.beginActive(round);
  }

  private resolveRound(): void {
    const ctx = this.gameCtx!;
    const mechanic = this.round?.mechanic;

    if (mechanic === "type") {
      this.lastRoundResults = [...this.responses.keys()].map((playerId) => ({ playerId, tally: 1, rank: 1, points: TYPE_PARTICIPATION_POINTS }));
    } else if (mechanic === "fast-tap") {
      this.lastRoundResults = this.tapOrder.map((playerId, i) => ({ playerId, tally: this.tapOrder.length - i, rank: i + 1, points: POINTS_BY_RANK[i] ?? 0 }));
    } else if (mechanic === "aim") {
      // Circular distance (accounting for the 0/360 wraparound) — closest heading to the
      // target wins, same rank->points shape every other mechanic already uses.
      const withDistance = [...this.aimLocked.entries()].map(([playerId, heading]) => {
        const diff = Math.abs(heading - this.targetHeading);
        return { playerId, distance: Math.min(diff, 360 - diff) };
      });
      withDistance.sort((a, b) => a.distance - b.distance);
      let rank = 0;
      let prevDistance: number | null = null;
      this.lastRoundResults = withDistance.map((r, i) => {
        if (prevDistance === null || r.distance !== prevDistance) rank = i + 1;
        prevDistance = r.distance;
        return { playerId: r.playerId, tally: Math.round(180 - r.distance), rank, points: POINTS_BY_RANK[rank - 1] ?? 0 };
      });
    } else {
      // "vote" and "would-you-rather" both tally picks the same way
      const counts = new Map<string, number>();
      for (const target of this.votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
      this.lastRoundResults = rankByTally([...counts.entries()].map(([playerId, tally]) => ({ playerId, tally })));
    }

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
    const mechanic = this.round.mechanic;

    if (mechanic === "type" && msg.type === "input:text") {
      this.responses.set(playerId, msg.text.slice(0, 140));
      return;
    }
    if (mechanic === "fast-tap" && msg.type === "input:button" && msg.pressed) {
      if (!this.tapOrder.includes(playerId)) this.tapOrder.push(playerId);
      return;
    }
    if (mechanic === "aim" && msg.type === "input:button" && msg.pressed) {
      if (this.aimLocked.has(playerId)) return;
      const heading = Number(msg.buttonId);
      if (!Number.isNaN(heading)) this.aimLocked.set(playerId, ((heading % 360) + 360) % 360);
      return;
    }
    if ((mechanic === "vote" || mechanic === "would-you-rather") && msg.type === "input:button" && msg.pressed) {
      if (mechanic === "vote" && playerId === msg.buttonId) return; // defensive — client already excludes self
      this.votes.set(playerId, msg.buttonId);
    }
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    this.responses.delete(playerId);
    this.votes.delete(playerId);
    this.aimLocked.delete(playerId);
    this.tapOrder = this.tapOrder.filter((id) => id !== playerId);
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
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = "600 15px -apple-system, sans-serif";
      ctx.fillText(this.mechanicLabel(this.round.mechanic), w / 2, h * 0.12);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "700 26px -apple-system, sans-serif";
      wrapText(ctx, this.round.prompt, w / 2, h * 0.24, w * 0.75, 32);
      if (this.round.choices) {
        ctx.font = "600 20px -apple-system, sans-serif";
        ctx.fillStyle = THEME.accent;
        wrapText(ctx, `${this.round.choices[0]}  vs  ${this.round.choices[1]}`, w / 2, h * 0.38, w * 0.75, 26);
      }
      if (this.round.mechanic === "aim") this.drawCompassRose(ctx, w / 2, h * 0.36, Math.min(w, h) * 0.1);
      const remaining = Math.max(0, this.phaseDeadline - now);
      ctx.font = "600 16px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(`${Math.ceil(remaining / 1000)}s`, w / 2, h * 0.46);

      const players = this.connectedPlayers();
      const hasAnswered = (playerId: string): boolean => {
        const mechanic = this.round!.mechanic;
        if (mechanic === "type") return this.responses.has(playerId);
        if (mechanic === "fast-tap") return this.tapOrder.includes(playerId);
        if (mechanic === "aim") return this.aimLocked.has(playerId);
        return this.votes.has(playerId);
      };
      ctx.font = "600 15px -apple-system, sans-serif";
      players.forEach((p, i) => {
        const y = h * 0.58 + i * 28;
        const ready = hasAnswered(p.id);
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

  private mechanicLabel(mechanic: WildcardMechanic): string {
    switch (mechanic) {
      case "vote": return "VOTE ON YOUR PHONE";
      case "type": return "TYPE ON YOUR PHONE";
      case "fast-tap": return "TAP FASTEST ON YOUR PHONE";
      case "would-you-rather": return "PICK A SIDE ON YOUR PHONE";
      case "aim": return "TURN YOUR BODY TO AIM";
    }
  }

  /** A simple compass rose marking the hidden target heading — not the players' live headings (those only exist on their own phones), just enough for the room to see roughly where "the target" is relative to N. */
  private drawCompassRose(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "600 12px -apple-system, sans-serif";
    ctx.fillText("N", cx, cy - radius - 12);

    const rad = (this.targetHeading * Math.PI) / 180;
    const tipX = cx + Math.sin(rad) * radius;
    const tipY = cy - Math.cos(rad) * radius;
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.fillStyle = THEME.accent;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
