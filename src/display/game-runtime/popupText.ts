export interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  bornAt: number;
  life: number;
}

export function spawnPopup(x: number, y: number, text: string, color: string): Popup {
  return { x, y, text, color, bornAt: performance.now(), life: 700 };
}

export function stepPopups(popups: Popup[], now: number): Popup[] {
  return popups.filter((p) => now - p.bornAt < p.life);
}

export function drawPopups(ctx: CanvasRenderingContext2D, popups: Popup[], now: number): void {
  ctx.textAlign = "center";
  ctx.font = "700 20px -apple-system, sans-serif";
  for (const p of popups) {
    const t = (now - p.bornAt) / p.life;
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y - t * 34);
  }
  ctx.globalAlpha = 1;
}
