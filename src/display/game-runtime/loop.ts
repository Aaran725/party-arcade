export class GameLoop {
  private raf: number | null = null;
  private lastTime = 0;

  constructor(private onTick: (dt: number) => void) {}

  start(): void {
    this.lastTime = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      try {
        this.onTick(dt);
      } catch (err) {
        // A bad frame (e.g. transient layout state) must never permanently stall the loop.
        console.error("[GameLoop] tick error:", err);
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}
