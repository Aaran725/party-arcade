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

/**
 * A uniform text/UI scale factor derived from the stage's own size, for games whose canvas
 * font sizes are otherwise tuned as fixed px literals. Exactly 1.0 (zero visual change) at
 * or below 675px in the shorter dimension — the stage's old fixed reference size before
 * display.css's `.stage-wrap` was allowed to grow past it — so nothing already tuned for a
 * normal window regresses; scales up proportionally only once the stage genuinely grows
 * larger than that, and is capped at 2.2x so an 8K screen doesn't get runaway oversized text.
 */
export function uiScale(w: number, h: number): number {
  return Math.min(2.2, Math.max(1, Math.min(w, h) / 675));
}

/** Wraps `text` into lines no wider than `maxWidth`, centered vertically around `cy`. Shared across every game that needs multi-line canvas text instead of each defining its own copy. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxWidth: number, lineHeight: number): void {
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
  }
  if (line) lines.push(line);
  const totalHeight = lines.length * lineHeight;
  const startY = cy - totalHeight / 2 + lineHeight / 2;
  const prevBaseline = ctx.textBaseline;
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
  ctx.textBaseline = prevBaseline;
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
