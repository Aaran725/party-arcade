import type { DrawFlush } from "./draw-capture";

interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
}

/**
 * Owns the controller's own live-preview drawing surface: mirrors the incoming
 * DrawFlush stream stroke-by-stroke (for immediate visual feedback while the relayed
 * points travel to the display) while also retaining full per-stroke point history,
 * so undo() can drop exactly the last stroke and redraw the rest from scratch —
 * something a plain incremental canvas can't do once ink has been committed.
 */
export class LocalStrokeCanvas {
  private strokes: Stroke[] = [];
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  private get ctx(): CanvasRenderingContext2D {
    return this.canvas.getContext("2d")!;
  }

  addFlush(flush: Pick<DrawFlush, "points" | "color" | "lineWidth" | "phase">): void {
    if (flush.phase === "start") this.strokes.push({ points: [], color: flush.color, lineWidth: flush.lineWidth });
    const stroke = this.strokes[this.strokes.length - 1];
    if (!stroke) return;

    const rect = this.canvas.getBoundingClientRect();
    const c2 = this.ctx;
    c2.strokeStyle = stroke.color;
    c2.lineWidth = stroke.lineWidth;

    for (const pt of flush.points) {
      stroke.points.push(pt);
      const x = pt.x * rect.width;
      const y = pt.y * rect.height;
      if (flush.phase === "start" && stroke.points.length === 1) {
        this.lastX = x;
        this.lastY = y;
        continue;
      }
      c2.beginPath();
      c2.moveTo(this.lastX, this.lastY);
      c2.lineTo(x, y);
      c2.stroke();
      this.lastX = x;
      this.lastY = y;
    }
  }

  undo(): void {
    this.strokes.pop();
    this.redraw();
  }

  clear(): void {
    this.strokes = [];
    this.redraw();
  }

  private redraw(): void {
    const rect = this.canvas.getBoundingClientRect();
    const c2 = this.ctx;
    c2.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of this.strokes) {
      c2.strokeStyle = stroke.color;
      c2.lineWidth = stroke.lineWidth;
      c2.beginPath();
      stroke.points.forEach((pt, i) => {
        const x = pt.x * rect.width;
        const y = pt.y * rect.height;
        if (i === 0) c2.moveTo(x, y);
        else c2.lineTo(x, y);
      });
      c2.stroke();
    }
  }
}
