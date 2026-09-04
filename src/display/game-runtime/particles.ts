export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  bornAt: number;
  life: number;
  kind: "spark" | "confetti" | "splat";
}

export function spawnBurst(
  x: number,
  y: number,
  color: string,
  count: number,
  opts?: { speed?: number; life?: number; kind?: Particle["kind"]; size?: number },
): Particle[] {
  const speed = opts?.speed ?? 140;
  const life = opts?.life ?? 420;
  const kind = opts?.kind ?? "spark";
  const size = opts?.size ?? 3;
  const now = performance.now();
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    return {
      x,
      y,
      vx: Math.cos(angle) * s,
      vy: Math.sin(angle) * s,
      color,
      size: size * (0.6 + Math.random() * 0.8),
      bornAt: now,
      life,
      kind,
    };
  });
}

export function spawnConfetti(w: number, h: number, colors: string[], count: number): Particle[] {
  const now = performance.now();
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: -10 - Math.random() * h * 0.3,
    vx: (Math.random() - 0.5) * 60,
    vy: 60 + Math.random() * 90,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: 4 + Math.random() * 5,
    bornAt: now,
    life: 2200 + Math.random() * 800,
    kind: "confetti" as const,
  }));
}

export function stepParticles(particles: Particle[], dt: number, now: number): Particle[] {
  const gravity = 220;
  for (const p of particles) {
    p.vy += gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.98;
  }
  return particles.filter((p) => now - p.bornAt < p.life);
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], now: number): void {
  for (const p of particles) {
    const t = (now - p.bornAt) / p.life;
    const alpha = Math.max(0, 1 - t);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    if (p.kind === "confetti") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(t * 8);
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
