const MAX_POINTS_PER_FLUSH = 30;

export interface DrawFlush {
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  strokeId: number;
  phase: "start" | "move" | "end";
  ts: number;
}

/**
 * Captures direct touch/drag on the controller's own canvas — a different pathway
 * from pointer-calibration.ts's device-orientation-driven "laser pointer" cursor.
 * Batches points via requestAnimationFrame (not a fixed-interval timer, which would
 * lose fidelity between samples and produce visibly segmented lines) and flushes
 * accumulated points each frame while a stroke is active.
 */
export class DrawCapture {
  private buffer: { x: number; y: number }[] = [];
  private strokeId = 0;
  private rafHandle = 0;
  private drawing = false;
  private canvas: HTMLCanvasElement | null = null;
  private strokeRect: DOMRect | null = null;
  private boundStart = (e: PointerEvent) => this.start(e);
  private boundMove = (e: PointerEvent) => this.move(e);
  private boundEnd = () => this.end();

  constructor(private color: string, private lineWidth: number, private onFlush: (msg: DrawFlush) => void) {}

  /** Live-updatable — the artist can change color/brush mid-drawing via the toolbar without restarting a stroke. */
  setColor(color: string): void {
    this.color = color;
  }

  setLineWidth(lineWidth: number): void {
    this.lineWidth = lineWidth;
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener("pointerdown", this.boundStart);
    canvas.addEventListener("pointermove", this.boundMove);
    canvas.addEventListener("pointerup", this.boundEnd);
    canvas.addEventListener("pointercancel", this.boundEnd);
  }

  private start(e: PointerEvent): void {
    e.preventDefault();
    this.strokeId++;
    this.drawing = true;
    // Cached once per stroke rather than re-measured per point: a mid-gesture
    // getBoundingClientRect() can return a transiently transformed box (e.g. an
    // ancestor still mid-CSS-animation), which would normalize points against a
    // moving target and draw the stroke offset from the actual touch position.
    this.strokeRect = this.canvas!.getBoundingClientRect();
    this.buffer = [this.normalize(e)];
    this.flush("start");
    this.scheduleFlush();
  }

  private move(e: PointerEvent): void {
    if (!this.drawing) return;
    e.preventDefault();
    // getCoalescedEvents() returns [] (not null/undefined) when there's no coalescing
    // data — a `?? [e]` fallback alone misses that case and silently drops the point.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    const events = coalesced.length > 0 ? coalesced : [e];
    for (const ev of events) this.buffer.push(this.normalize(ev));
    if (this.buffer.length > MAX_POINTS_PER_FLUSH) {
      this.buffer.splice(0, this.buffer.length - MAX_POINTS_PER_FLUSH);
    }
  }

  private scheduleFlush(): void {
    this.rafHandle = requestAnimationFrame(() => {
      if (this.buffer.length) this.flush("move");
      if (this.drawing) this.scheduleFlush();
    });
  }

  private flush(phase: DrawFlush["phase"]): void {
    if (this.buffer.length === 0 && phase !== "end") return;
    this.onFlush({ points: this.buffer.splice(0), color: this.color, lineWidth: this.lineWidth, strokeId: this.strokeId, phase, ts: Date.now() });
  }

  private end(): void {
    if (!this.drawing) return;
    this.drawing = false;
    cancelAnimationFrame(this.rafHandle);
    this.flush("end");
  }

  private normalize(e: PointerEvent): { x: number; y: number } {
    const r = this.strokeRect ?? this.canvas!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  destroy(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener("pointerdown", this.boundStart);
    this.canvas.removeEventListener("pointermove", this.boundMove);
    this.canvas.removeEventListener("pointerup", this.boundEnd);
    this.canvas.removeEventListener("pointercancel", this.boundEnd);
    cancelAnimationFrame(this.rafHandle);
  }
}
