import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { createStageCanvas, uiScale, wrapText, roundRect, drawSpecularEdge } from "../../game-runtime/canvas";
import { PhaseMachine } from "../../game-runtime/roundEngine";
import { connectedPlayers } from "../../game-runtime/players";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx } from "@shared/audio";

const ROUND_COUNT = 3;
const RULES_MS = 6500;
const SCENARIO_TIMEOUT_MS = 8000; // last-resort local fallback — the server itself always answers, even on total AI failure
const RESPOND_MS = 25_000;
const VOTE_MS = 15_000;
const RESULT_MS = 4000;
const POINTS_BY_RANK = [25, 15, 8];
const THEME = THEMES["plot-twist"];

const RULES_LINES = [
  "Each round, an AI dreams up an absurd little scenario.",
  "Everyone types a one-line response from their phone.",
  "Then vote for your favorite (not your own) — best response wins the round.",
];

// Only reached if game:scenario_result never arrives at all (a dropped message) — the
// server's getScenario() already guarantees a reply, AI-generated or its own fallback.
const LOCAL_FALLBACK_SCENARIOS = [
  "The Wi-Fi router has started speaking only in riddles. What do you ask it first?",
  "You find a second doorbell hidden behind a plant. Do you ring it?",
];

type Phase = "rules" | "waiting_scenario" | "respond" | "voting" | "result";

interface RankedResult {
  playerId: string;
  votes: number;
  rank: number;
  points: number;
}

function rankResults(counts: { playerId: string; votes: number }[]): RankedResult[] {
  const sorted = [...counts].sort((a, b) => b.votes - a.votes);
  const results: RankedResult[] = [];
  let rank = 0;
  let prevVotes: number | null = null;
  sorted.forEach((r, i) => {
    if (prevVotes === null || r.votes !== prevVotes) rank = i + 1;
    prevVotes = r.votes;
    results.push({ playerId: r.playerId, votes: r.votes, rank, points: POINTS_BY_RANK[rank - 1] ?? 0 });
  });
  return results;
}

export class PlotTwistDisplay implements DisplayGameModule {
  id = "plot-twist" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  private roundIndex = 0;
  private scenario = "";
  private responses = new Map<string, string>(); // playerId -> text, this round
  private votes = new Map<string, string>(); // voterId -> targetId
  private lastRoundResults: RankedResult[] = [];

  private readonly phases = new PhaseMachine<Phase>("rules", {
    rules: { onExpire: () => this.startRound() },
    waiting_scenario: {
      onExpire: () => this.beginRespondPhase(LOCAL_FALLBACK_SCENARIOS[Math.floor(Math.random() * LOCAL_FALLBACK_SCENARIOS.length)]),
    },
    // No endEarlyWhen on respond on purpose: a response can be retyped right up to the
    // buzzer, so "everyone has one" isn't final — cutting it short would lock in a draft.
    respond: { onExpire: () => this.beginVoting() },
    voting: {
      onExpire: () => this.resolveVotes(),
      endEarlyWhen: () => {
        const players = this.connectedPlayers();
        return players.length > 0 && players.every((p) => this.votes.has(p.id));
      },
    },
    result: { onExpire: () => this.startRound() },
  });

  private particles: Particle[] = [];

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    for (const p of ctx.players) this.scores.set(p.id, 0);
    this.roundIndex = 0;
    this.phases.setPhase("rules", RULES_MS);
  }

  private connectedPlayers(): PlayerInfo[] {
    return connectedPlayers(this.gameCtx!.players, this.connectedIds);
  }

  private nameFor(id: string): string {
    return this.gameCtx!.players.find((p) => p.id === id)?.name ?? "Someone";
  }

  private startRound(): void {
    if (this.roundIndex >= ROUND_COUNT || this.connectedPlayers().length < 2) {
      this.finishGame();
      return;
    }
    this.responses.clear();
    this.votes.clear();
    this.phases.setPhase("waiting_scenario", SCENARIO_TIMEOUT_MS);
    this.gameCtx!.requestScenario();
    sfx.uiTap();
  }

  private beginRespondPhase(scenario: string): void {
    this.scenario = scenario;
    for (const p of this.connectedPlayers()) this.gameCtx!.sendPrivate(p.id, { scenario });
    this.phases.setPhase("respond", RESPOND_MS);
    sfx.roundStart();
    this.gameCtx!.hostSpeak(scenario);
  }

  onScenarioResult(scenario: string): void {
    if (this.phases.phase !== "waiting_scenario") return;
    this.beginRespondPhase(scenario);
  }

  private beginVoting(): void {
    const ctx = this.gameCtx!;
    const roster = [...this.responses.entries()].map(([playerId, text]) => ({ playerId, text }));
    if (roster.length < 2) {
      this.resolveVotes();
      return;
    }
    for (const p of this.connectedPlayers()) ctx.sendPrivate(p.id, { phase: "vote", responses: roster });
    this.phases.setPhase("voting", VOTE_MS);
  }

  private resolveVotes(): void {
    const ctx = this.gameCtx!;
    const counts = new Map<string, number>();
    for (const id of this.responses.keys()) counts.set(id, 0);
    for (const targetId of this.votes.values()) {
      if (counts.has(targetId)) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
    }
    this.lastRoundResults = rankResults([...counts.entries()].map(([playerId, votes]) => ({ playerId, votes })));

    for (const r of this.lastRoundResults) {
      const score = (this.scores.get(r.playerId) ?? 0) + r.points;
      this.scores.set(r.playerId, score);
      ctx.onScoreUpdate(r.playerId, score);
    }

    if (this.lastRoundResults.length > 0) sfx.hit(3);
    else sfx.miss();

    this.phases.setPhase("result", RESULT_MS);
    this.roundIndex += 1;
  }

  private finishGame(): void {
    const ctx = this.gameCtx!;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const colors = this.connectedPlayers().map((p) => p.color);
    this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, colors.length ? colors : [THEME.accent], 70));
    sfx.gameOverFanfare();
    // finish() halts phase dispatch and is idempotent. Previously this left `phase`/
    // `phaseDeadline` untouched, so the already-expired phase re-ran startRound() → this
    // method every frame for the full 900ms: ~54 confetti bursts and fanfares stacked up.
    this.phases.finish(900, () => ctx.onGameOver(this.getScores()));
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type === "input:text") {
      if (this.phases.phase !== "respond" || !this.connectedIds.has(playerId)) return;
      this.responses.set(playerId, msg.text.slice(0, 140));
      return;
    }
    if (msg.type === "input:button" && msg.pressed) {
      if (this.phases.phase !== "voting" || !this.connectedIds.has(playerId)) return;
      if (playerId === msg.buttonId) return; // defensive — client already excludes self
      if (!this.responses.has(msg.buttonId)) return;
      this.votes.set(playerId, msg.buttonId);
    }
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    this.responses.delete(playerId);
    this.votes.delete(playerId);
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    this.phases.tick(now, dt);

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

    if (this.phases.phase === "rules") {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `700 ${Math.round(30 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText("🌀 Plot Twist", w / 2, h * 0.22);
      ctx.font = `500 ${Math.round(19 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => wrapText(ctx, line, w / 2, h * 0.4 + i * 46, w * 0.78, 26));
      return;
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `600 ${Math.round(16 * uiScale(w, h))}px -apple-system, sans-serif`;
    ctx.fillText(`Round ${Math.min(this.roundIndex + 1, ROUND_COUNT)} / ${ROUND_COUNT}`, w / 2, 28);

    if (this.phases.phase === "waiting_scenario") {
      this.drawGlassPanel(ctx, w * 0.2, h * 0.36, w * 0.6, h * 0.18);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
      const dots = ".".repeat((Math.floor(now / 400) % 3) + 1);
      ctx.fillText(`🌀 Thinking of something absurd${dots}`, w / 2, h * 0.45);
      return;
    }

    if (this.phases.phase === "respond") {
      this.drawGlassPanel(ctx, w * 0.08, h * 0.08, w * 0.84, h * 0.3);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
      wrapText(ctx, this.scenario, w / 2, h * 0.18, w * 0.75, 32);
      const remaining = this.phases.remaining(now);
      ctx.font = `600 ${Math.round(16 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(`${Math.ceil(remaining / 1000)}s`, w / 2, h * 0.32);

      const players = this.connectedPlayers();
      ctx.font = `600 ${Math.round(15 * uiScale(w, h))}px -apple-system, sans-serif`;
      players.forEach((p, i) => {
        const y = h * 0.46 + i * 30;
        const ready = this.responses.has(p.id);
        ctx.fillStyle = ready ? "#30D158" : "rgba(255,255,255,0.5)";
        ctx.fillText(`${ready ? "✓" : "…"} ${p.name}`, w / 2, y);
      });
      return;
    }

    if (this.phases.phase === "voting") {
      this.drawGlassPanel(ctx, w * 0.08, h * 0.06, w * 0.84, h * 0.84);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `600 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
      wrapText(ctx, this.scenario, w / 2, h * 0.1, w * 0.75, 24);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `700 ${Math.round(20 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText("Vote on your phone", w / 2, h * 0.22);

      const roster = [...this.responses.values()];
      const rowH = Math.min(64, (h * 0.6) / Math.max(1, roster.length));
      const top = h * 0.3;
      ctx.font = `600 ${Math.round(17 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      roster.forEach((text, i) => wrapText(ctx, `"${text}"`, w / 2, top + i * rowH, w * 0.7, 22));
      return;
    }

    // result
    this.drawGlassPanel(ctx, w * 0.08, h * 0.06, w * 0.84, h * 0.88);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
    ctx.fillText("Round results", w / 2, h * 0.1);
    if (this.lastRoundResults.length === 0) {
      ctx.font = `500 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("Nobody submitted a response in time.", w / 2, h * 0.4);
    } else {
      const rowH = Math.min(96, (h * 0.75) / this.lastRoundResults.length);
      this.lastRoundResults.forEach((r, i) => {
        const y = h * 0.18 + i * rowH;
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = `700 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillText(`#${r.rank}  ${this.nameFor(r.playerId)}`, w * 0.08, y);
        ctx.font = `500 ${Math.round(15 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        wrapText(ctx, `"${this.responses.get(r.playerId) ?? ""}"`, w * 0.08 + 140, y + 4, w * 0.55, 20);

        ctx.textAlign = "right";
        ctx.font = `700 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillStyle = THEME.accent;
        ctx.fillText(`${r.votes} vote${r.votes === 1 ? "" : "s"} · +${r.points}`, w * 0.94, y);
        ctx.textAlign = "left";
      });
    }
    ctx.textAlign = "center";
    drawParticles(ctx, this.particles, now);
  }

  /** A themed glass card behind this phase's content — matches the roundRect+drawSpecularEdge chrome the rest of the roster already uses, previously missing here since Plot Twist drew straight onto the ambient background. */
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
