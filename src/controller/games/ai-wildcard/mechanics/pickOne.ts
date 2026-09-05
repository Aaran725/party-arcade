import { el } from "@shared/dom";
import type { ControllerMechanicRenderer } from "./types";

export const renderPickOne: ControllerMechanicRenderer = ({ ctx, payload, submit }) => {
  const options = payload.choices ?? ["Option A", "Option B"];
  const buttons = options.map((opt) => {
    const btn = el("button", { class: "glass-button accent" }, [opt]);
    btn.addEventListener("click", () => submit(15, { type: "input:button", buttonId: opt, pressed: true, ts: Date.now() }));
    return btn;
  });
  ctx.root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
      el("h2", { class: "title-md" }, [payload.prompt]),
      ...buttons,
    ]),
  );
};
