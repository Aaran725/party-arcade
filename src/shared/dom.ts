type Attrs = Record<string, string | number | boolean | undefined> & { class?: string };

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/** Checked once per call rather than cached — this is a live OS-level setting, and there's no real cost to re-reading it. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const TRANSITION_OUT_MS = 180;

/**
 * Call immediately before replacing `root`'s content for a screen swap (i.e. right
 * before a `render*Screen(root, ...)` call that ends in `root.replaceChildren(...)`).
 * Clones the outgoing children into a fixed-position overlay sized and laid out to
 * match root's current box, then fades/scales it out — so the swap reads as a
 * cross-fade against the new screen's own `anim-pop-in` entrance instead of a hard cut.
 * No-op if root is empty or not laid out yet (e.g. first render).
 */
export function transitionOut(root: HTMLElement): void {
  if (!root.childNodes.length || prefersReducedMotion()) return;
  const rect = root.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  const computed = getComputedStyle(root);
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; top: ${rect.top}px; left: ${rect.left}px; width: ${rect.width}px; height: ${rect.height}px;
    display: ${computed.display}; align-items: ${computed.alignItems}; justify-content: ${computed.justifyContent};
    flex-direction: ${computed.flexDirection}; gap: ${computed.gap}; padding: ${computed.padding};
    pointer-events: none; z-index: 9999; overflow: hidden;
    transition: opacity var(--duration-fast) var(--smooth-easing), transform var(--duration-fast) var(--smooth-easing), filter var(--duration-fast) var(--smooth-easing);
  `;
  for (const child of Array.from(root.childNodes)) overlay.append(child.cloneNode(true));
  document.body.append(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = "0";
    // A touch of blur alongside the existing fade/scale — a viscous "melting away" rather
    // than a plain fade, matching the liquid glass material the rest of the app now uses.
    overlay.style.transform = "scale(0.97)";
    overlay.style.filter = "blur(6px)";
  });
  setTimeout(() => overlay.remove(), TRANSITION_OUT_MS);
}
