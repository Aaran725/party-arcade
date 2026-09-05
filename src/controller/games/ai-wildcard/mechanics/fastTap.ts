import { el } from "@shared/dom";
import type { ControllerMechanicRenderer } from "./types";

export const renderFastTap: ControllerMechanicRenderer = ({ ctx, payload, submit }) => {
  const btn = el("button", { class: "buzzer-btn", style: "background:linear-gradient(160deg,#FFD60A,#FF9F0A);width:100%;aspect-ratio:1;font-size:1.6rem" }, ["TAP!"]);
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    submit(20, { type: "input:button", buttonId: "tap", pressed: true, ts: Date.now() });
  });
  ctx.root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
      el("h2", { class: "title-md" }, [payload.prompt]),
      btn,
    ]),
  );
};
