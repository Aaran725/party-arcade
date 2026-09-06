import type { PlayerInfo } from "@shared/types/room";
import type { PartyHistoryEntry } from "./PartySession";
import { buildCards } from "./recapCards";
import { roundRect, drawSpecularEdge } from "../game-runtime/canvas";

const W = 1080;
const H = 1350;
const PAD = 60;
const CARD_H = 170;
const CARD_GAP = 24;
// The party recap reel can run long (a full night's worth of games) — the shareable image
// is a highlight card, not the whole reel, so only the highest-value cards make it in.
const MAX_CARDS = 6;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
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
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/**
 * Composes one shareable image from the same card data the on-screen recap reel uses
 * (buildCards, in recapCards.ts) — a single canvas, not a live DOM screen, so it can be
 * exported via toDataURL() and shared/downloaded straight from PartyFinaleScreen's "Share
 * recap" button. Uses the same roundRect/drawSpecularEdge glass-chrome pair every game's
 * own canvas already draws with, so it reads as part of the same visual family.
 */
export async function renderRecapImageCard(opts: {
  players: PlayerInfo[];
  standings: Record<string, number>;
  history: PartyHistoryEntry[];
  achievements: { playerId: string; achievementIds: string[] }[];
  levelUps: { playerId: string; level: number }[];
}): Promise<string> {
  const cards = buildCards(opts).slice(0, MAX_CARDS);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const bg = ctx.createRadialGradient(W * 0.2, 0, 0, W * 0.2, 0, W * 0.95);
  bg.addColorStop(0, "#232338");
  bg.addColorStop(1, "#0b0b12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "700 54px -apple-system, sans-serif";
  ctx.fillText("🎉 Party Arcade", W / 2, 100);
  ctx.font = "500 26px -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText(new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }), W / 2, 140);

  let y = 190;
  const cardW = W - PAD * 2;

  for (const card of cards) {
    if (y + CARD_H > H - 60) break; // more cards than fit — the rest just don't make the image

    roundRect(ctx, PAD, y, cardW, CARD_H, 28);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.stroke();
    drawSpecularEdge(ctx, PAD, y, cardW, CARD_H, 28, 0.25);

    const contentX = PAD + 30;
    let textX: number;

    if (card.image) {
      const thumbSize = CARD_H - 30;
      try {
        const img = await loadImage(card.image);
        ctx.save();
        roundRect(ctx, contentX, y + 15, thumbSize, thumbSize, 16);
        ctx.clip();
        const scale = Math.max(thumbSize / img.width, thumbSize / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, contentX + (thumbSize - dw) / 2, y + 15 + (thumbSize - dh) / 2, dw, dh);
        ctx.restore();
      } catch {
        // A stale/expired image URL shouldn't sink the whole card — just fall through
        // to the icon-only layout below instead of leaving a blank hole.
        ctx.font = "56px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(card.icon, contentX, y + CARD_H / 2 + 18);
      }
      textX = contentX + thumbSize + 24;
    } else {
      ctx.font = "56px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(card.icon, contentX, y + CARD_H / 2 + 18);
      textX = contentX + 90;
    }

    const textMaxWidth = PAD + cardW - textX - 20;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "700 32px -apple-system, sans-serif";
    wrapLines(ctx, card.title, textMaxWidth, 2).forEach((line, i) => ctx.fillText(line, textX, y + 55 + i * 36));
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "500 24px -apple-system, sans-serif";
    wrapLines(ctx, card.body, textMaxWidth, 2).forEach((line, i) => ctx.fillText(line, textX, y + 118 + i * 30));

    y += CARD_H + CARD_GAP;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "600 20px -apple-system, sans-serif";
  ctx.fillText("Party Arcade", W / 2, H - 30);

  return canvas.toDataURL("image/png");
}
