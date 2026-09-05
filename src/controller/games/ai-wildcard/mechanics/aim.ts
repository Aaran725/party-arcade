import { el } from "@shared/dom";
import { onCompassHeading } from "../../../input/motion";
import type { ControllerMechanicRenderer } from "./types";

// How close the live heading needs to render as "on target" — purely a visual cue, the
// real scoring (Display-side, circular distance to the hidden target) doesn't use this.
const AIM_CLOSE_DEG = 15;

export const renderAim: ControllerMechanicRenderer = ({ ctx, payload, submit }) => {
  const target = payload.targetHeading ?? 0;
  let currentHeading = 0;

  const headingLabel = el("div", { class: "title-lg mono" }, ["--°"]);
  const status = el("p", { class: "text-caption" }, ["Turn your body until you're pointing the right way"]);
  const lockBtn = el("button", { class: "glass-button accent" }, ["🎯 Lock In!"]);

  lockBtn.addEventListener("click", () => {
    submit(15, { type: "input:button", buttonId: String(Math.round(currentHeading)), pressed: true, ts: Date.now() });
  });

  ctx.root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
      el("h2", { class: "title-md" }, [payload.prompt]),
      headingLabel,
      status,
      lockBtn,
    ]),
  );

  return onCompassHeading((heading) => {
    currentHeading = heading;
    headingLabel.textContent = `${Math.round(heading)}°`;
    const diff = Math.abs(heading - target);
    const distance = Math.min(diff, 360 - diff);
    headingLabel.style.color = distance <= AIM_CLOSE_DEG ? "var(--accent-success)" : "var(--text-0)";
  });
};
