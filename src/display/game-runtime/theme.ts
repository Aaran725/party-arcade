import type { GameId } from "@shared/types/room";

export interface GameTheme {
  bg0: string;
  bg1: string;
  accent: string;
  accent2?: string;
  motif: "pulseRings" | "grid" | "scanline" | "lightShaft" | "bezel" | "weave" | "spotlight";
}

export const THEMES: Record<GameId, GameTheme> = {
  "reaction-buzzer": { bg0: "#1a0b2e", bg1: "#2d0f3f", accent: "#FF375F", motif: "pulseRings" },
  "tilt-maze": { bg0: "#060b18", bg1: "#0d1b33", accent: "#64D2FF", motif: "grid" },
  "laser-blaster": { bg0: "#04070a", bg1: "#0d1410", accent: "#FF9F0A", motif: "scanline" },
  "fruit-slice": { bg0: "#1a0f08", bg1: "#2b1608", accent: "#30D158", motif: "lightShaft" },
  "simon-says": { bg0: "#150d05", bg1: "#241708", accent: "#FF375F", motif: "bezel" },
  "paint-wars": { bg0: "#12100d", bg1: "#1c1812", accent: "#9a9a92", motif: "weave" },
  "trivia-buzzer": { bg0: "#0a0e1f", bg1: "#170a2e", accent: "#FFD60A", motif: "spotlight" },
  "sleeper-agent": { bg0: "#0a0505", bg1: "#1f0a0a", accent: "#FF453A", motif: "spotlight" },
  "doodle-relay": { bg0: "#050a08", bg1: "#0d1f16", accent: "#30D158", motif: "grid" },
  "draw-off": { bg0: "#0d0817", bg1: "#1f1033", accent: "#BF5AF2", motif: "pulseRings" },
  "scream-royale": { bg0: "#1f0505", bg1: "#3a0a0a", accent: "#FF453A", motif: "scanline" },
  "snap-judgment": { bg0: "#08131a", bg1: "#0f2430", accent: "#64D2FF", motif: "bezel" },
  "echo-chain": { bg0: "#120a1f", bg1: "#241238", accent: "#BF5AF2", motif: "scanline" },
  "plot-twist": { bg0: "#0a1408", bg1: "#152a10", accent: "#FFD60A", motif: "lightShaft" },
  "push-battle": { bg0: "#1a0505", bg1: "#330a0a", accent: "#FF453A", motif: "scanline" },
  "ai-wildcard": { bg0: "#150a1f", bg1: "#2a1040", accent: "#BF5AF2", motif: "pulseRings" },
  "hot-potato": { bg0: "#1f1005", bg1: "#3a1c08", accent: "#FF9F0A", motif: "pulseRings" },
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * One-line drop-in replacing a flat `ctx.fillStyle = "#0d0d16"; ctx.fillRect(...)`.
 * accentOverride lets a game shift the motif color dynamically (Simon Says matches the
 * currently-flashing tile) without needing a whole new theme entry.
 */
export function drawAmbientBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: GameTheme,
  now: number,
  accentOverride?: string,
): void {
  const accent = accentOverride ?? theme.accent;
  const [ar, ag, ab] = hexToRgb(accent);

  const grad = ctx.createRadialGradient(w / 2, h * 0.32, 0, w / 2, h / 2, Math.max(w, h) * 0.85);
  grad.addColorStop(0, theme.bg1);
  grad.addColorStop(1, theme.bg0);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  switch (theme.motif) {
    case "pulseRings":
      drawPulseRings(ctx, w, h, ar, ag, ab, now);
      break;
    case "grid":
      drawGrid(ctx, w, h, ar, ag, ab, now);
      break;
    case "scanline":
      drawScanline(ctx, w, h, ar, ag, ab, now);
      break;
    case "lightShaft":
      drawLightShaft(ctx, w, h, ar, ag, ab);
      break;
    case "bezel":
      drawBezel(ctx, w, h, ar, ag, ab);
      break;
    case "weave":
      drawWeave(ctx, w, h, ar, ag, ab);
      break;
    case "spotlight":
      drawSpotlight(ctx, w, h, ar, ag, ab);
      break;
  }
  ctx.restore();
}

function drawPulseRings(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, g: number, b: number, now: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const base = Math.min(w, h) * 0.22;
  for (let i = 0; i < 3; i++) {
    const phase = (now / 1400 + i / 3) % 1;
    const radius = base + phase * Math.min(w, h) * 0.5;
    ctx.globalAlpha = 0.12 * (1 - phase);
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, g: number, b: number, now: number): void {
  const spacing = 56;
  const pulse = 0.05 + 0.03 * Math.sin(now / 1600);
  ctx.strokeStyle = `rgba(${r},${g},${b},${pulse})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y < h; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function drawScanline(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, g: number, b: number, now: number): void {
  const y = ((now % 3200) / 3200) * h;
  const grad = ctx.createLinearGradient(0, y - 40, 0, y + 40);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},0.08)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, y - 40, w, 80);

  ctx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
  ctx.lineWidth = 2;
  const bracket = 26;
  const pad = 18;
  const corners: [number, number, number, number][] = [
    [pad, pad, 1, 1],
    [w - pad, pad, -1, 1],
    [pad, h - pad, 1, -1],
    [w - pad, h - pad, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + bracket * dy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + bracket * dx, cy);
    ctx.stroke();
  }
}

function drawLightShaft(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, g: number, b: number): void {
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(w * (0.2 + i * 0.3), 0);
    ctx.rotate(-0.35);
    ctx.fillRect(0, -h * 0.3, w * 0.14, h * 1.8);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawBezel(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, g: number, b: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.max(w, h) * 0.75;
  const grad = ctx.createRadialGradient(cx, cy, outer * 0.55, cx, cy, outer);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = `rgba(${r},${g},${b},0.18)`;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w, h) * 0.46, 0, Math.PI * 2);
  ctx.stroke();
}

function drawWeave(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, g: number, b: number): void {
  ctx.strokeStyle = `rgba(${r},${g},${b},0.05)`;
  ctx.lineWidth = 1;
  const spacing = 22;
  ctx.beginPath();
  for (let i = -h; i < w; i += spacing) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
  }
  for (let i = 0; i < w + h; i += spacing) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i - h, h);
  }
  ctx.stroke();
}

function drawSpotlight(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, g: number, b: number): void {
  for (const cx of [w * 0.12, w * 0.88]) {
    const grad = ctx.createRadialGradient(cx, -40, 0, cx, -40, h * 0.9);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.14)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}
