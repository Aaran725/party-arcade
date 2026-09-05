import type { DisplayMechanicHandler } from "./types";
import { rankByDistance } from "./shared";

export function createAimMechanic(): DisplayMechanicHandler {
  const locked = new Map<string, number>(); // playerId -> the heading they locked in

  return {
    label: "TURN YOUR BODY TO AIM",
    reset: () => locked.clear(),
    hasAnswered: (playerId) => locked.has(playerId),
    handleInput: (playerId, msg) => {
      if (msg.type !== "input:button" || !msg.pressed) return;
      if (locked.has(playerId)) return;
      const heading = Number(msg.buttonId);
      if (!Number.isNaN(heading)) locked.set(playerId, ((heading % 360) + 360) % 360);
    },
    resolve: (_players, round) => {
      const target = round.secret ?? 0;
      // Circular distance (accounting for the 0/360 wraparound) — closest heading to the
      // target wins.
      const withDistance = [...locked.entries()].map(([playerId, heading]) => {
        const diff = Math.abs(heading - target);
        return { playerId, distance: Math.min(diff, 360 - diff) };
      });
      return rankByDistance(withDistance, (distance) => Math.round(180 - distance));
    },
    onPlayerLeave: (playerId) => locked.delete(playerId),
    drawExtra: (ctx, cx, cy, w, h, round, accent) => drawCompassRose(ctx, cx, cy, Math.min(w, h) * 0.1, round.secret ?? 0, accent),
  };
}

/** A simple compass rose marking the hidden target heading — not the players' live headings (those only exist on their own phones), just enough for the room to see roughly where "the target" is relative to N. */
function drawCompassRose(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, targetHeading: number, accent: string): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "600 12px -apple-system, sans-serif";
  ctx.fillText("N", cx, cy - radius - 12);

  const rad = (targetHeading * Math.PI) / 180;
  const tipX = cx + Math.sin(rad) * radius;
  const tipY = cy - Math.cos(rad) * radius;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
