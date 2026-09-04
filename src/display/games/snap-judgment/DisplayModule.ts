import type { DisplayGameContext, DisplayGameModule } from "@shared/types/game";
import type { InputMessage } from "@shared/protocol/messages";
import type { PlayerInfo } from "@shared/types/room";
import { createStageCanvas, roundRect, drawSpecularEdge } from "../../game-runtime/canvas";
import { drawAmbientBackground, THEMES } from "../../game-runtime/theme";
import { type Particle, drawParticles, spawnConfetti, stepParticles } from "../../game-runtime/particles";
import { sfx } from "@shared/audio";

const ROUND_COUNT = 3;
const RULES_MS = 6500;
const CAPTURE_MS = 10_000;
const VOTE_MS = 15_000;
const RESULT_MS = 3500;
const POINTS_BY_RANK = [25, 15, 8];
const PROMPTS = ["Strike your best superhero pose!", "Show me your most shocked face!", "Give me your best 'I just won the lottery' reaction!"];
const THEME = THEMES["snap-judgment"];

const RULES_LINES = ["Everyone gets the same prompt and 10 seconds to capture a photo.", "Then everyone votes for their favorite (not their own).", "Photos never leave this room's Wi-Fi."];

type Phase = "rules" | "capture" | "voting" | "result";

interface RankedResult {
  playerId: string;
  votes: number;
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

function gridLayout(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  return { cols: 4, rows: 2 };
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

export class SnapJudgmentDisplay implements DisplayGameModule {
  id = "snap-judgment" as const;

  private stage: ReturnType<typeof createStageCanvas> | null = null;
  private gameCtx: DisplayGameContext | null = null;
  private scores = new Map<string, number>();
  private connectedIds = new Set<string>();

  private roundIndex = 0;
  private phase: Phase = "rules";
  private phaseDeadline = 0;
  private photos = new Map<string, string>(); // playerId -> data URL, this round
  private photoImages = new Map<string, HTMLImageElement>();
  private votes = new Map<string, string>(); // voterId -> targetId
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
    const ctx = this.gameCtx!;
    this.photos.clear();
    this.photoImages.clear();
    this.votes.clear();
    const prompt = PROMPTS[Math.min(this.roundIndex, PROMPTS.length - 1)];
    for (const p of this.connectedPlayers()) ctx.sendPrivate(p.id, { prompt });
    this.phase = "capture";
    this.phaseDeadline = performance.now() + CAPTURE_MS;
    sfx.roundStart();
  }

  private beginVoting(): void {
    const ctx = this.gameCtx!;
    const roster = [...this.photos.keys()].map((id) => {
      const p = this.connectedPlayers().find((pp) => pp.id === id)!;
      return { id: p.id, name: p.name, imageData: this.photos.get(id)! };
    });
    if (roster.length < 2) {
      // Nobody to vote between — skip straight to a (likely empty) result rather than
      // stranding players on a vote screen with fewer than two real choices.
      this.resolveVotes();
      return;
    }
    for (const p of this.connectedPlayers()) ctx.sendPrivate(p.id, { phase: "vote", photos: roster });
    this.phase = "voting";
    this.phaseDeadline = performance.now() + VOTE_MS;
  }

  private resolveVotes(): void {
    const ctx = this.gameCtx!;
    const counts = new Map<string, number>();
    for (const id of this.photos.keys()) counts.set(id, 0);
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

    const winner = this.lastRoundResults[0];
    if (winner && winner.votes > 0) {
      const winnerPhoto = this.photos.get(winner.playerId);
      if (winnerPhoto) {
        ctx.setHighlight(winnerPhoto, `${this.nameFor(winner.playerId)}'s winning photo — ${winner.votes} vote${winner.votes === 1 ? "" : "s"}`);
      }
    }

    this.phase = "result";
    this.phaseDeadline = performance.now() + RESULT_MS;
    this.roundIndex += 1;
  }

  private finishGame(): void {
    const ctx = this.gameCtx!;
    const canvas = this.stage!.canvas;
    const dpr = window.devicePixelRatio || 1;
    const colors = this.connectedPlayers().map((p) => p.color);
    this.particles.push(...spawnConfetti(canvas.width / dpr, canvas.height / dpr, colors.length ? colors : ["#64D2FF"], 70));
    sfx.gameOverFanfare();
    setTimeout(() => ctx.onGameOver(this.getScores()), 900);
  }

  getScores(): Record<string, number> {
    const final: Record<string, number> = {};
    for (const [id, s] of this.scores) final[id] = s;
    return final;
  }

  onInput(playerId: string, msg: InputMessage): void {
    if (msg.type === "input:photo") {
      if (this.phase !== "capture" || !this.connectedIds.has(playerId)) return;
      this.photos.set(playerId, msg.imageData);
      const img = new Image();
      img.src = msg.imageData;
      this.photoImages.set(playerId, img);
      return;
    }
    if (msg.type === "input:button" && msg.pressed) {
      if (this.phase !== "voting" || !this.connectedIds.has(playerId)) return;
      if (playerId === msg.buttonId) return; // defensive — client already excludes self
      if (!this.photos.has(msg.buttonId)) return;
      this.votes.set(playerId, msg.buttonId);
    }
  }

  onPlayerLeave(playerId: string): void {
    this.connectedIds.delete(playerId);
    this.photos.delete(playerId);
    this.photoImages.delete(playerId);
    this.votes.delete(playerId);
  }

  tick(dt: number): void {
    if (!this.stage) return;
    const now = performance.now();

    switch (this.phase) {
      case "rules":
        if (now >= this.phaseDeadline) this.startRound();
        break;
      case "capture":
        if (now >= this.phaseDeadline) this.beginVoting();
        break;
      case "voting":
        if (now >= this.phaseDeadline) this.resolveVotes();
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
      ctx.fillText("📸 Snap Judgment", w / 2, h * 0.22);
      ctx.font = "500 19px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      RULES_LINES.forEach((line, i) => wrapText(ctx, line, w / 2, h * 0.4 + i * 46, w * 0.78, 26));
      return;
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "600 16px -apple-system, sans-serif";
    ctx.fillText(`Round ${Math.min(this.roundIndex + 1, ROUND_COUNT)} / ${ROUND_COUNT}`, w / 2, 28);

    if (this.phase === "capture") {
      const prompt = PROMPTS[Math.min(this.roundIndex, PROMPTS.length - 1)];
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "700 26px -apple-system, sans-serif";
      wrapText(ctx, prompt, w / 2, h * 0.16, w * 0.7, 32);
      const remaining = Math.max(0, this.phaseDeadline - now);
      ctx.font = "600 18px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText(`${Math.ceil(remaining / 1000)}s`, w / 2, h * 0.28);

      const players = this.connectedPlayers();
      ctx.font = "600 15px -apple-system, sans-serif";
      players.forEach((p, i) => {
        const y = h * 0.4 + i * 30;
        const ready = this.photos.has(p.id);
        ctx.fillStyle = ready ? "#30D158" : "rgba(255,255,255,0.5)";
        ctx.textAlign = "center";
        ctx.fillText(`${ready ? "✓" : "…"} ${p.name}`, w / 2, y);
      });
      return;
    }

    if (this.phase === "voting") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "700 22px -apple-system, sans-serif";
      ctx.fillText("Vote on your phone", w / 2, h * 0.1);
      this.drawPhotoGrid(ctx, w, h);
      return;
    }

    // result
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "700 24px -apple-system, sans-serif";
    ctx.fillText("Round results", w / 2, h * 0.1);
    if (this.lastRoundResults.length === 0) {
      ctx.font = "500 18px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("Nobody captured a photo in time.", w / 2, h * 0.4);
    } else {
      const rowH = Math.min(90, (h * 0.75) / this.lastRoundResults.length);
      this.lastRoundResults.forEach((r, i) => {
        const y = h * 0.2 + i * rowH;
        const img = this.photoImages.get(r.playerId);
        const thumbH = rowH * 0.82;
        const thumbW = thumbH * 0.75;
        const thumbRadius = Math.min(12, thumbH * 0.08);
        if (img?.complete) {
          ctx.save();
          roundRect(ctx, w * 0.15, y, thumbW, thumbH, thumbRadius);
          ctx.clip();
          ctx.drawImage(img, w * 0.15, y, thumbW, thumbH);
          ctx.restore();
          drawSpecularEdge(ctx, w * 0.15, y, thumbW, thumbH, thumbRadius, 0.22);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          roundRect(ctx, w * 0.15, y, thumbW, thumbH, thumbRadius);
          ctx.fill();
        }
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "700 18px -apple-system, sans-serif";
        ctx.fillText(`#${r.rank}  ${this.nameFor(r.playerId)}`, w * 0.15 + thumbW + 18, y + thumbH * 0.4);
        ctx.font = "600 15px -apple-system, sans-serif";
        ctx.fillStyle = THEME.accent;
        ctx.fillText(`${r.votes} vote${r.votes === 1 ? "" : "s"} · +${r.points}`, w * 0.15 + thumbW + 18, y + thumbH * 0.65);
      });
    }
    ctx.textAlign = "center";
    drawParticles(ctx, this.particles, now);
  }

  private drawPhotoGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const ids = [...this.photos.keys()];
    if (ids.length === 0) return;
    const { cols, rows } = gridLayout(ids.length);
    const pad = 16;
    const top = h * 0.16;
    const cellW = (w - pad * (cols + 1)) / cols;
    const cellH = (h - top - pad * (rows + 1)) / rows;
    const voteCounts = new Map<string, number>();
    for (const targetId of this.votes.values()) voteCounts.set(targetId, (voteCounts.get(targetId) ?? 0) + 1);

    ids.forEach((id, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * (cellW + pad);
      const y = top + pad + row * (cellH + pad);
      const p = this.connectedPlayers().find((pp) => pp.id === id);
      const img = this.photoImages.get(id);

      const cellRadius = Math.min(16, cellW * 0.06, cellH * 0.06);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(ctx, x, y, cellW, cellH, cellRadius);
      ctx.fill();
      if (img?.complete) {
        const scale = Math.min(cellW / img.width, cellH / img.height) || 1;
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.save();
        roundRect(ctx, x, y, cellW, cellH, cellRadius);
        ctx.clip();
        ctx.drawImage(img, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);
        ctx.restore();
      }
      ctx.strokeStyle = p?.color ?? "#fff";
      ctx.lineWidth = 2.5;
      roundRect(ctx, x, y, cellW, cellH, cellRadius);
      ctx.stroke();
      drawSpecularEdge(ctx, x, y, cellW, cellH, cellRadius, 0.22);

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "600 13px -apple-system, sans-serif";
      const votes = voteCounts.get(id) ?? 0;
      ctx.fillText(`${p?.name ?? "?"}${votes > 0 ? ` · ${votes}` : ""}`, x + cellW / 2, y + cellH - 8);
    });
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}
