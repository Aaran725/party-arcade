const FILTER_ID = "glass-distortion";

function svgFilterMarkup(): string {
  return (
    `<filter id="${FILTER_ID}" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.008 0.03" numOctaves="2" seed="7" result="noise" />` +
    `<feGaussianBlur in="noise" stdDeviation="2" result="blurred" />` +
    `<feDisplacementMap in="SourceGraphic" in2="blurred" scale="18" xChannelSelector="R" yChannelSelector="G" />` +
    `</filter>`
  );
}

/**
 * Real optical refraction for the glass material — an SVG feDisplacementMap filter referenced
 * via `backdrop-filter: url(#glass-distortion)` — is genuine progressive enhancement, not a
 * universal upgrade: iOS Safari has never supported referencing an SVG filter from
 * backdrop-filter, and naively feature-detecting it via `@supports` is unreliable (it tests
 * CSS parse validity, not whether the browser actually applies the referenced filter — on a
 * browser that parses but ignores it, trusting `@supports` risks the *whole* backdrop-filter
 * declaration being dropped, losing the ordinary blur too). This instead does a real runtime
 * probe: render an offscreen element with the filter applied and read back its computed style
 * — only if the browser echoes the `url(...)` back does it flag the document via a class, so
 * glass.css's progressive-enhancement rule can safely opt in. Everywhere else (all of iOS,
 * most of today's web) nothing changes: the ordinary blur+sheen glass stays exactly as it was.
 */
export function initGlassRefraction(): void {
  if (document.getElementById(FILTER_ID)) return;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;overflow:hidden;pointer-events:none";
  svg.innerHTML = svgFilterMarkup();
  document.body.prepend(svg);

  const probe = document.createElement("div");
  probe.style.cssText =
    `position:fixed;left:-9999px;top:-9999px;width:10px;height:10px;` +
    `backdrop-filter:url(#${FILTER_ID}) blur(1px);-webkit-backdrop-filter:url(#${FILTER_ID}) blur(1px);`;
  document.body.append(probe);

  const computed = getComputedStyle(probe);
  const applied = computed.backdropFilter || computed.getPropertyValue("-webkit-backdrop-filter");
  probe.remove();

  if (applied && applied !== "none" && applied.includes("url(")) {
    document.documentElement.classList.add("glass-refraction-ok");
  }
}
