// Procedurally generated player avatars — deterministic from a player's id, no asset
// pipeline (mirrors game-runtime/audio.ts's "synthesized, not loaded" philosophy).
// Same id always produces the same face on every client with zero image data sent.

export type BodyShape = "round" | "square" | "pointy" | "wavy";
export type EyeStyle = "dot" | "wide" | "sleepy" | "wink" | "star";
export type MouthStyle = "smile" | "grin" | "flat" | "open" | "smirk";
export type Accessory = "none" | "antenna" | "bow" | "horn" | "spot" | "cap";

const BODY_SHAPES: readonly BodyShape[] = ["round", "square", "pointy", "wavy"];
const EYE_STYLES: readonly EyeStyle[] = ["dot", "wide", "sleepy", "wink", "star"];
const MOUTH_STYLES: readonly MouthStyle[] = ["smile", "grin", "flat", "open", "smirk"];
const ACCESSORIES: readonly Accessory[] = ["none", "antenna", "bow", "horn", "spot", "cap"];

export interface AvatarFeatures {
  bodyShape: BodyShape;
  eyeStyle: EyeStyle;
  mouthStyle: MouthStyle;
  accessory: Accessory;
  accessoryHue: number;
}

function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function avatarFeaturesForSeed(id: string): AvatarFeatures {
  const rand = mulberry32(hashString(id));
  return {
    bodyShape: pick(rand, BODY_SHAPES),
    eyeStyle: pick(rand, EYE_STYLES),
    mouthStyle: pick(rand, MOUTH_STYLES),
    accessory: pick(rand, ACCESSORIES),
    accessoryHue: Math.floor(rand() * 360),
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

const INK = "rgba(0,0,0,0.78)";

function bodyShapeEl(shape: BodyShape, color: string): SVGElement {
  switch (shape) {
    case "round":
      return svgEl("circle", { cx: 20, cy: 20, r: 16, fill: color });
    case "square":
      return svgEl("rect", { x: 4, y: 4, width: 32, height: 32, rx: 10, fill: color });
    case "pointy":
      return svgEl("path", { d: "M20 3 L37 20 L20 37 L3 20 Z", fill: color });
    case "wavy":
      return svgEl("path", {
        d: "M20 4 C28 4 34 8 36 16 C38 24 34 32 26 35 C18 38 8 34 5 26 C2 18 6 8 14 5 C16 4 18 4 20 4 Z",
        fill: color,
      });
  }
}

function starPoints(cx: number, cy: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    const r = i % 2 === 0 ? 2.6 : 1.1;
    pts.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
  }
  return pts.join(" ");
}

const EYE_L = 14;
const EYE_R = 26;
const EYE_Y = 17;

function eyesEl(style: EyeStyle): SVGElement {
  const g = svgEl("g");
  switch (style) {
    case "dot":
      g.append(svgEl("circle", { cx: EYE_L, cy: EYE_Y, r: 2.1, fill: INK }), svgEl("circle", { cx: EYE_R, cy: EYE_Y, r: 2.1, fill: INK }));
      break;
    case "wide":
      g.append(
        svgEl("circle", { cx: EYE_L, cy: EYE_Y, r: 3.4, fill: INK }),
        svgEl("circle", { cx: EYE_R, cy: EYE_Y, r: 3.4, fill: INK }),
        svgEl("circle", { cx: EYE_L + 1, cy: EYE_Y - 1, r: 0.9, fill: "#fff" }),
        svgEl("circle", { cx: EYE_R + 1, cy: EYE_Y - 1, r: 0.9, fill: "#fff" }),
      );
      break;
    case "sleepy":
      g.append(
        svgEl("path", { d: `M${EYE_L - 2.5} ${EYE_Y} Q${EYE_L} ${EYE_Y + 2} ${EYE_L + 2.5} ${EYE_Y}`, stroke: INK, "stroke-width": 1.8, fill: "none", "stroke-linecap": "round" }),
        svgEl("path", { d: `M${EYE_R - 2.5} ${EYE_Y} Q${EYE_R} ${EYE_Y + 2} ${EYE_R + 2.5} ${EYE_Y}`, stroke: INK, "stroke-width": 1.8, fill: "none", "stroke-linecap": "round" }),
      );
      break;
    case "wink":
      g.append(
        svgEl("circle", { cx: EYE_L, cy: EYE_Y, r: 2.4, fill: INK }),
        svgEl("path", { d: `M${EYE_R - 2.5} ${EYE_Y} Q${EYE_R} ${EYE_Y - 2} ${EYE_R + 2.5} ${EYE_Y}`, stroke: INK, "stroke-width": 1.8, fill: "none", "stroke-linecap": "round" }),
      );
      break;
    case "star":
      g.append(svgEl("polygon", { points: starPoints(EYE_L, EYE_Y), fill: INK }), svgEl("polygon", { points: starPoints(EYE_R, EYE_Y), fill: INK }));
      break;
  }
  return g;
}

function mouthEl(style: MouthStyle): SVGElement {
  const cx = 20;
  const y = 27;
  switch (style) {
    case "smile":
      return svgEl("path", { d: `M${cx - 6} ${y} Q${cx} ${y + 5} ${cx + 6} ${y}`, stroke: INK, "stroke-width": 2, fill: "none", "stroke-linecap": "round" });
    case "grin":
      return svgEl("path", { d: `M${cx - 7} ${y - 1} Q${cx} ${y + 6} ${cx + 7} ${y - 1} Z`, fill: INK });
    case "flat":
      return svgEl("line", { x1: cx - 6, y1: y, x2: cx + 6, y2: y, stroke: INK, "stroke-width": 2, "stroke-linecap": "round" });
    case "open":
      return svgEl("ellipse", { cx, cy: y + 1, rx: 3.4, ry: 4, fill: INK });
    case "smirk":
      return svgEl("path", { d: `M${cx - 5} ${y} Q${cx + 2} ${y + 4} ${cx + 6} ${y - 2}`, stroke: INK, "stroke-width": 2, fill: "none", "stroke-linecap": "round" });
  }
}

function accessoryEl(accessory: Accessory, hue: number): SVGElement | null {
  if (accessory === "none") return null;
  const color = `hsl(${hue},70%,60%)`;
  switch (accessory) {
    case "antenna": {
      const g = svgEl("g");
      g.append(
        svgEl("line", { x1: 20, y1: 4, x2: 20, y2: -1, stroke: color, "stroke-width": 2, "stroke-linecap": "round" }),
        svgEl("circle", { cx: 20, cy: -2, r: 2.4, fill: color }),
      );
      return g;
    }
    case "bow":
      return svgEl("path", { d: "M13 1 L20 5 L27 1 L27 6 L20 10 L13 6 Z", fill: color });
    case "horn":
      return svgEl("path", { d: "M17 5 L20 -4 L23 5 Z", fill: color });
    case "spot":
      return svgEl("circle", { cx: 27, cy: 14, r: 3.5, fill: color, opacity: 0.85 });
    case "cap":
      return svgEl("path", { d: "M8 8 Q20 -5 32 8 L32 11 L8 11 Z", fill: color });
  }
}

/** Builds a ready-to-append inline SVG avatar, deterministic from `id`. `color` should be the player's assigned color. */
export function createAvatarSvg(id: string, color: string, opts: { size?: string } = {}): SVGSVGElement {
  const features = avatarFeaturesForSeed(id);
  const svg = svgEl("svg", { viewBox: "-4 -6 48 48" }) as SVGSVGElement;
  svg.setAttribute("class", "avatar-badge");
  const size = opts.size ?? "0.6em";
  svg.style.width = size;
  svg.style.height = size;
  svg.style.color = color;

  svg.append(bodyShapeEl(features.bodyShape, color));
  const accessory = accessoryEl(features.accessory, features.accessoryHue);
  if (accessory) svg.append(accessory);
  svg.append(eyesEl(features.eyeStyle));
  svg.append(mouthEl(features.mouthStyle));

  return svg;
}
