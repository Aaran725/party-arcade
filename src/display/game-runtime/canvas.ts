export function createStageCanvas(root: HTMLElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; dispose: () => void } {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  root.append(canvas);
  const ctx = canvas.getContext("2d")!;

  function resize() {
    const rect = root.getBoundingClientRect();
    // Skip transient near-zero layout states (e.g. mid-mount, mid-reflow) rather than
    // shrinking the canvas to ~1px, which produces degenerate (negative) draw math downstream.
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(root);

  return {
    canvas,
    ctx,
    dispose: () => {
      ro.disconnect();
      canvas.remove();
    },
  };
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * An optional top-edge specular highlight for a rounded rect already drawn via
 * roundRect() — the canvas-side match for glass.css's light-catching top edge. Purely
 * additive: call it right after your own fill()/stroke() on the same shape; it clips to
 * that shape and paints a soft fading white gradient over its top half, so it never
 * changes roundRect()'s own path or any of its existing callers unless they opt in.
 */
export function drawSpecularEdge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  intensity = 0.35,
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const grad = ctx.createLinearGradient(x, y, x, y + h * 0.5);
  grad.addColorStop(0, `rgba(255,255,255,${intensity})`);
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h * 0.5);
  ctx.restore();
}
