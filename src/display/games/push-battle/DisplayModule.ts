import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { createStageCanvas, roundRect, drawSpecularEdge, uiScale, wrapText } from "../../game-runtime/canvas";
import { PhaseMachine } from "../../game-runtime/roundEngine";
import { connectedPlayers } from "../../game-runtime/players";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnBurst, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx } from "@shared/audio";
import { ReactionGate } from "../../game-runtime/leaderReactions";
import { pickCloseCallLine } from "@shared/game-leader-lines";

const RULES_MS = 5500;
const MATCHUP_INTRO_MS = 2200;
const BATTLE_SAFETY_CAP_MS = 12_000; // whoever's ahead wins if nobody reaches the edge in time
const ROUND_RESULT_MS = 2200;
const METER_MAX = 100;
const PUSH_IMPULSE = 5;
const DECAY_PER_SEC = 25; // meter relaxes toward center — a lead has to be actively maintained, not just sprinted once
const POINTS_BY_RANK = [25, 15, 8];
const PREDICTION_BONUS = 5;
const THEME = THEMES["push-battle"];

const RULES_LINES = [
  "Single-elimination bracket. Two players, one shared meter.",
  "Mash your button to push the meter toward your side — let up and it drifts back to center.",
  "First to shove it all the way to your edge wins the match.",
];

type Phase = "rules" | "matchup_intro" | "battle" | "round_result" | "tournament_result";

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface RankedResult {
  playerId: string;
  rank: number;
  points: number;
}

/** Ranks by how many bracket rounds a player survived — the tournament winner gets a value higher than anyone could reach by elimination. Ties (players knocked out in the same round) share a rank, same convention as every other ranked game in this app. */
function rankByRoundsSurvived(entries: { playerId: string; roundsSurvived: number }[]): RankedResult[] {
  const sorted = [...entries].sort((a, b) => b.roundsSurvived - a.roundsSurvived);
  const results: RankedResult[] = [];
  let rank = 0;
  let prev: number | null = null;
  sorted.forEach((r, i) => {
    if (prev === null || r.roundsSurvived !== prev) rank = i + 1;
    prev = r.roundsSurvived;
    results.push({ playerId: r.playerId, rank, points: POINTS_BY_RANK[rank - 1] ?? 0 });
  });
  return results;
}

export class PushBattleDisplay implements DisplayGameModule {
  id = "push-battle" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  // Single-elimination bracket state. currentRound is the queue of players still waiting
  // for their match this round; nextRound collects winners until the round is exhausted.
  private currentRound: string[] = [];
  private nextRound: string[] = [];
  private roundIndex = 0;
  private eliminationRound = new Map<string, number>();
  private championId: string | null = null;

  private currentMatch: [string, string] | null = null;
  // The just-finished match, kept alive for the round_result screen. resolveMatch() has to
  // clear currentMatch immediately (sendRoles() and prediction input both key off it), so the
  // result branch of draw() reads this instead.
  private resolvedMatch: { pair: [string, string]; winnerId: string } | null = null;
  private meter = 0; // negative leans toward currentMatch[0], positive toward currentMatch[1]
  private battleStartedAt = 0;
  private reactionGate = new ReactionGate();
  // Companion Spectator Mode: anyone not in the current match can predict its winner for a
  // small bonus — reset per match, scored the instant that match resolves.
  private predictions = new Map<string, string>();

  private lastRankedResults: RankedResult[] = [];

  private readonly phases = new PhaseMachine<Phase>("rules", {
    rules: { onExpire: () => this.startNextRound() },
    matchup_intro: { onExpire: () => this.beginBattle() },
    battle: {
      // Per-frame physics, not a countdown: the meter relaxes toward center off `dt` so an
      // idle lead erodes and a comeback is always possible.
      onFrame: (_now, _remaining, dt) => {
        if (this.meter > 0) this.meter = Math.max(0, this.meter - DECAY_PER_SEC * dt);
        else if (this.meter < 0) this.meter = Math.min(0, this.meter + DECAY_PER_SEC * dt);
      },
      // The battle also ends early when a meter maxes out (see onInput) — that's a transition,
      // not endEarlyWhen. This is only the safety cap: whoever's ahead takes it.
      onExpire: () => {
        if (!this.currentMatch) return;
        const [a, b] = this.currentMatch;
        this.resolveMatch(this.meter <= 0 ? a : b);
      },
    },
    round_result: { onExpire: () => this.startNextRound() },
  });

  private particles: Particle[] = [];

  init(ctx: DisplayGameContext): void {
    this.gameCtx = ctx;
    this.stage = createStageCanvas(ctx.root);
    this.scores.clear();
    this.connectedIds = new Set(ctx.players.map((p) => p.id));
    for (const p of ctx.players) this.scores.set(p.id, 0);
    this.currentRound = shuffle(ctx.players.map((p) => p.id));
    this.nextRound = [];
    this.roundIndex = 0;
    this.eliminationRound.clear();
    this.championId = null;
    this.currentMatch = null;
    this.resolvedMatch = null;
    this.phases.setPhase("rules", RULES_MS);
  }

  private connectedPlayers(): PlayerInfo[] {
    return connectedPlayers(this.gameCtx!.players, this.connectedIds);
  }

  private nameFor(id: string): string {
    return this.gameCtx!.players.find((p) => p.id === id)?.name ?? "Someone";
  }

  private sendRoles(): void {
    const ctx = this.gameCtx!;
    // Anyone currently spectating (not in this match) gets a chance to predict its winner —
    // only offered while there's an actual live match to predict on.
    const predictCandidates = this.currentMatch ? this.currentMatch.map((id) => ({ id, name: this.nameFor(id) })) : undefined;
    for (const p of this.connectedPlayers()) {
      if (this.currentMatch?.includes(p.id)) {
        const opponentId = this.currentMatch[0] === p.id ? this.currentMatch[1] : this.currentMatch[0];
        ctx.sendPrivate(p.id, { role: "battling", opponent: this.nameFor(opponentId) });
      } else if (p.id === this.championId) {
        ctx.sendPrivate(p.id, { role: "champion" });
      } else if (this.eliminationRound.has(p.id)) {
        ctx.sendPrivate(p.id, { role: "eliminated", predictCandidates });
      } else {
        ctx.sendPrivate(p.id, { role: "waiting", predictCandidates });
      }
    }
  }

  /** Advances the bracket: pops the next match from the current round, rolls over to the next round when it's exhausted, or ends the tournament once only one player remains. */
  private startNextRound(): void {
    // A lone leftover player this round gets a bye straight through — no dedicated screen
    // for it (kept out of scope), they just silently carry into the next round.
    while (this.currentRound.length === 1 && this.nextRound.length + this.currentRound.length > 1) {
      this.nextRound.push(this.currentRound.pop()!);
    }
    if (this.currentRound.length === 0) {
      if (this.nextRound.length <= 1) {
        this.finishTournament(this.nextRound[0] ?? null);
        return;
      }
      this.currentRound = shuffle(this.nextRound);
      this.nextRound = [];
      this.roundIndex++;
    }

    const a = this.currentRound.pop();
    const b = this.currentRound.pop();
    if (!a || !b) {
      // Odd leftover with nobody to pair against (e.g. a disconnect mid-round) — treat as a bye.
      if (a) this.nextRound.push(a);
      this.startNextRound();
      return;
    }
    this.currentMatch = [a, b];
    this.meter = 0;
    this.predictions.clear();
    this.phases.setPhase("matchup_intro", MATCHUP_INTRO_MS);
    this.sendRoles();
  }

  private beginBattle(): void {
    this.battleStartedAt = performance.now();
    this.phases.setPhase("battle", BATTLE_SAFETY_CAP_MS, this.battleStartedAt);
    sfx.roundStart();
  }

  private resolveMatch(winnerId: string): void {
    const [a, b] = this.currentMatch!;
    const loserId = winnerId === a ? b : a;
    this.eliminationRound.set(loserId, this.roundIndex);
    this.nextRound.push(winnerId);
    // Stash the pair + winner before clearing currentMatch: draw()'s head-to-head layout is
    // gated on having a match, so nulling it here used to blank the entire round_result
    // screen — the "<winner> wins the match!" line was never reachable.
    this.resolvedMatch = { pair: [a, b], winnerId };
    this.currentMatch = null;

    const ctx = this.gameCtx!;
    for (const [predictorId, targetId] of this.predictions) {
      if (targetId !== winnerId) continue;
      const score = (this.scores.get(predictorId) ?? 0) + PREDICTION_BONUS;
      this.scores.set(predictorId, score);
      ctx.onScoreUpdate(predictorId, score);
    }

    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const color = this.connectedPlayers().find((p) => p.id === winnerId)?.color ?? THEME.accent;
    this.particles.push(...spawnBurst(w / 2, h * 0.5, color, 20, { speed: 200 }));
    sfx.hit(2);

    // A match that ran most of the safety cap was a genuine back-and-forth, not a stomp.
    const elapsed = performance.now() - this.battleStartedAt;
    if (elapsed > BATTLE_SAFETY_CAP_MS * 0.7) {
      this.reactionGate.fire(ctx.hostSpeak, pickCloseCallLine());
    }

    this.phases.setPhase("round_result", ROUND_RESULT_MS);
    this.sendRoles();
  }

  private finishTournament(winnerId: string | null): void {
    const ctx = this.gameCtx!;
    this.championId = winnerId;
    const maxRound = this.roundIndex + 1; // the champion "survived" one round further than anyone eliminated this round
    const entries = this.connectedPlayers().map((p) => ({
      playerId: p.id,
      roundsSurvived: p.id === winnerId ? maxRound : this.eliminationRound.get(p.id) ?? -1,
    }));
    this.lastRankedResults = rankByRoundsSurvived(entries);

    for (const r of this.lastRankedResults) {
      const score = (this.scores.get(r.playerId) ?? 0) + r.points;
      this.scores.set(r.playerId, score);
      ctx.onScoreUpdate(r.playerId, score);
    }

    // No deadline: the results board stays up until finish() fires the game-over below.
    this.phases.setPhase("tournament_result");
    this.sendRoles();
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const colors = this.connectedPlayers().map((p) => p.color);
    this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, colors.length ? colors : [THEME.accent], 70));
    sfx.gameOverFanfare();
    ctx.hostSpeak(winnerId ? `And the Push Battle champion is... ${this.nameFor(winnerId)}!` : "Push Battle is over — nobody was left standing.");
    // finish() halts phase dispatch and is idempotent, so a re-entrant bracket advance can't
    // stack confetti bursts or fire game-over twice.
    this.phases.finish(4000, () => ctx.onGameOver(this.getScores()));
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type === "input:prediction") {
      if (!this.currentMatch || this.currentMatch.includes(playerId)) return; // only spectators predict, not the two players actually battling
      if (this.currentMatch.includes(msg.targetPlayerId)) this.predictions.set(playerId, msg.targetPlayerId);
      return;
    }
    if (msg.type !== "input:button" || !msg.pressed) return;
    if (this.phases.phase !== "battle" || !this.currentMatch) return;
    const [a, b] = this.currentMatch;
    if (playerId === a) this.meter = Math.max(-METER_MAX, this.meter - PUSH_IMPULSE);
    else if (playerId === b) this.meter = Math.min(METER_MAX, this.meter + PUSH_IMPULSE);
    else return;

    if (this.meter <= -METER_MAX) this.resolveMatch(a);
    else if (this.meter >= METER_MAX) this.resolveMatch(b);
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    if (this.currentMatch?.includes(playerId)) {
      const [a, b] = this.currentMatch;
      this.resolveMatch(playerId === a ? b : a);
    }
    this.currentRound = this.currentRound.filter((id) => id !== playerId);
    this.nextRound = this.nextRound.filter((id) => id !== playerId);
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
      ctx.fillText("🤜 Push Battle", w / 2, h * 0.22);
      ctx.font = `500 ${Math.round(19 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => wrapText(ctx, line, w / 2, h * 0.4 + i * 46, w * 0.78, 26));
      return;
    }

    if (this.phases.phase === "tournament_result") {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `700 ${Math.round(26 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillText(this.championId ? `🏆 ${this.nameFor(this.championId)} wins it all!` : "Tournament over", w / 2, h * 0.14);
      const rowH = Math.min(70, (h * 0.7) / Math.max(1, this.lastRankedResults.length));
      this.lastRankedResults.forEach((r, i) => {
        const y = h * 0.28 + i * rowH;
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = `600 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillText(`#${r.rank}  ${this.nameFor(r.playerId)}`, w * 0.15, y);
        ctx.textAlign = "right";
        ctx.font = `700 ${Math.round(18 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillStyle = THEME.accent;
        ctx.fillText(`+${r.points}`, w * 0.85, y);
      });
      ctx.textAlign = "center";
      drawParticles(ctx, this.particles, now);
      return;
    }

    // matchup_intro / battle / round_result all share the head-to-head layout. round_result
    // falls back to the resolved match because resolveMatch() clears currentMatch as soon as
    // the bracket advances — gating on currentMatch alone left this whole screen blank.
    const resolved = this.phases.phase === "round_result" ? this.resolvedMatch : null;
    const match = resolved?.pair ?? this.currentMatch;
    if (match) {
      const [a, b] = match;
      const pa = this.connectedPlayers().find((p) => p.id === a);
      const pb = this.connectedPlayers().find((p) => p.id === b);

      ctx.font = `700 ${Math.round(22 * uiScale(w, h))}px -apple-system, sans-serif`;
      ctx.fillStyle = pa?.color ?? "#fff";
      ctx.textAlign = "left";
      ctx.fillText(pa?.name ?? "?", w * 0.08, h * 0.14);
      ctx.fillStyle = pb?.color ?? "#fff";
      ctx.textAlign = "right";
      ctx.fillText(pb?.name ?? "?", w * 0.92, h * 0.14);
      ctx.textAlign = "center";

      if (this.phases.phase === "matchup_intro") {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = `600 ${Math.round(20 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillText("Get ready…", w / 2, h * 0.4);
      }

      // The meter itself
      const barW = w * 0.7;
      const barX = w * 0.15;
      const barY = h * 0.45;
      const barH = Math.max(28, h * 0.05); // was a flat 36px regardless of screen size
      const barRadius = barH / 2;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      roundRect(ctx, barX, barY, barW, barH, barRadius);
      ctx.fill();
      const fraction = (this.meter + METER_MAX) / (METER_MAX * 2); // 0 = fully a's side, 1 = fully b's side
      const midX = barX + barW / 2;
      const knobX = barX + fraction * barW;
      const fillX = Math.min(midX, knobX);
      const fillW = Math.abs(midX - knobX);
      if (fillW > 1) {
        ctx.save();
        roundRect(ctx, barX, barY, barW, barH, barRadius);
        ctx.clip(); // keeps the fill's straight inner edge from poking past the track's own rounded ends
        ctx.fillStyle = pa?.color ?? THEME.accent;
        ctx.fillRect(fillX, barY, fillW, barH);
        drawSpecularEdge(ctx, fillX, barY, fillW, barH, 0, 0.3);
        ctx.restore();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
      roundRect(ctx, barX, barY, barW, barH, barRadius);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(midX, barY - 8);
      ctx.lineTo(midX, barY + barH + 8);
      ctx.stroke();

      if (resolved) {
        const winnerId = resolved.winnerId;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = `700 ${Math.round(24 * uiScale(w, h))}px -apple-system, sans-serif`;
        ctx.fillText(`${this.nameFor(winnerId)} wins the match!`, w / 2, h * 0.65);
      }
    }

    drawParticles(ctx, this.particles, now);
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
