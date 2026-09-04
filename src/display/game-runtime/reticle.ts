function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A soft, low-opacity glowing laser-pointer dot — used by any game that shows a player's aim point. */
export function drawReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  scale: number,
  flashing: boolean,
): void {
  const [cr, cg, cb] = hexToRgb(color);
  const glowRadius = scale * (flashing ? 0.045 : 0.032);
  const coreRadius = scale * (flashing ? 0.012 : 0.008);

  const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
  gradient.addColorStop(0, `rgba(${cr},${cg},${cb},${flashing ? 0.55 : 0.32})`);
  gradient.addColorStop(0.6, `rgba(${cr},${cg},${cb},${flashing ? 0.22 : 0.12})`);
  gradient.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  ctx.beginPath();
  ctx.fillStyle = gradient;
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = `rgba(${cr},${cg},${cb},${flashing ? 0.95 : 0.75})`;
  ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
  ctx.fill();
}

/** A fading blade trail behind a moving reticle — pass each reticle's last ~6 positions. */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; t: number }[],
  color: string,
  now: number,
): void {
  if (points.length < 2) return;
  const [cr, cg, cb] = hexToRgb(color);
  const maxAge = 220;
  ctx.lineCap = "round";
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const age = now - b.t;
    if (age > maxAge) continue;
    const alpha = Math.max(0, 1 - age / maxAge) * 0.5;
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
    ctx.lineWidth = 5 * (1 - age / maxAge);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}
