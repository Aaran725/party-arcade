import { el } from "@shared/dom";
import type { ControllerMechanicRenderer } from "./types";

export const renderVote: ControllerMechanicRenderer = ({ ctx, payload, submit }) => {
  const others = payload.candidates.filter((c) => c.id !== ctx.playerId);
  const cards = others.map((c) => {
    const card = el("div", { class: "glass-card game-card anim-pop-in", style: "align-items:center;justify-content:center" }, [
      el("span", { class: "text-body" }, [c.name]),
    ]);
    card.addEventListener("click", () => {
      submit(15, { type: "input:button", buttonId: c.id, pressed: true, ts: Date.now() });
    });
    return card;
  });
  ctx.root.replaceChildren(
    el("div", { style: "width:100%" }, [
      el("div", { class: "screen-header" }, [el("h2", { class: "title-md" }, [payload.prompt])]),
      el("div", { class: "vote-grid" }, cards),
    ]),
  );
};
