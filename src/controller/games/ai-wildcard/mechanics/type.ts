import { el } from "@shared/dom";
import type { ControllerMechanicRenderer } from "./types";

const MAX_TYPE_LEN = 60;

export const renderType: ControllerMechanicRenderer = ({ ctx, payload, submit }) => {
  const input = el("input", { class: "glass-input", placeholder: "Type your answer…", maxlength: MAX_TYPE_LEN }) as HTMLInputElement;
  const counter = el("p", { class: "text-caption", style: "align-self:flex-end" }, [`0/${MAX_TYPE_LEN}`]);
  input.addEventListener("input", () => {
    counter.textContent = `${input.value.length}/${MAX_TYPE_LEN}`;
  });
  const submitBtn = el("button", { class: "glass-button accent" }, ["Submit"]);
  const doSubmit = () => {
    const text = input.value.trim();
    if (!text) return;
    submit(15, { type: "input:text", text, ts: Date.now() });
  };
  submitBtn.addEventListener("click", doSubmit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && doSubmit());
  ctx.root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:0.8em" }, [
      el("h2", { class: "title-md" }, [payload.prompt]),
      input,
      counter,
      submitBtn,
    ]),
  );
  setTimeout(() => input.focus(), 50);
};
