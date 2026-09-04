import { el } from "@shared/dom";
import { PLAYER_COLORS } from "@shared/colors";
import { vibrate } from "../input/haptics";

const BRUSH_SIZES: { label: string; width: number }[] = [
  { label: "Thin", width: 3 },
  { label: "Medium", width: 5 },
  { label: "Thick", width: 9 },
];

/**
 * A real color + brush-size picker for the drawing games — `.color-swatches`/`.color-swatch`
 * (controller.css) already existed for exactly this and were never wired up, leaving
 * doodle-relay and draw-off hardcoded to a single fixed lineWidth with no way to change
 * stroke color from whatever the player's own identity color happened to be.
 */
export function mountDrawToolbar(opts: {
  initialColor: string;
  onColorChange: (color: string) => void;
  onSizeChange: (width: number) => void;
}): HTMLElement {
  const swatchEls: HTMLElement[] = [];
  const swatches = PLAYER_COLORS.map((color) => {
    const swatch = el("div", { class: `color-swatch${color === opts.initialColor ? " selected" : ""}`, style: `background:${color}` });
    swatch.addEventListener("click", () => {
      vibrate(10);
      opts.onColorChange(color);
      for (const s of swatchEls) s.classList.remove("selected");
      swatch.classList.add("selected");
    });
    swatchEls.push(swatch);
    return swatch;
  });

  const sizeBtns: HTMLElement[] = [];
  const sizeButtons = BRUSH_SIZES.map(({ label, width }, i) => {
    const btn = el("button", { class: `glass-button draw-toolbar-btn${i === 1 ? " accent" : ""}` }, [label]);
    btn.addEventListener("click", () => {
      vibrate(10);
      opts.onSizeChange(width);
      for (const b of sizeBtns) b.classList.remove("accent");
      btn.classList.add("accent");
    });
    sizeBtns.push(btn);
    return btn;
  });

  return el("div", { style: "display:flex;flex-direction:column;gap:0.6em;align-items:center;width:100%" }, [
    el("div", { class: "color-swatches" }, swatches),
    el("div", { class: "draw-toolbar" }, sizeButtons),
  ]);
}
