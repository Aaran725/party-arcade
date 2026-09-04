import { el } from "@shared/dom";

export function renderReconnectingScreen(root: HTMLElement): void {
  root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("span", { class: "color-dot anim-pulse", style: "color:#8E8EA0;background:#8E8EA0;width:1.4em;height:1.4em" }),
      el("h2", { class: "title-md" }, ["Reconnecting…"]),
      el("p", { class: "text-body" }, ["Rejoining your game."]),
    ]),
  );
}
