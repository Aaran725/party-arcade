import { el } from "@shared/dom";
import { NUMBER_GUESS_RANGE } from "@shared/wildcardConfig";
import type { ControllerMechanicRenderer } from "./types";

export const renderNumberGuess: ControllerMechanicRenderer = ({ ctx, payload, submit }) => {
  const input = el("input", {
    class: "glass-input",
    type: "number",
    inputmode: "numeric",
    placeholder: `0 - ${NUMBER_GUESS_RANGE}`,
    min: "0",
    max: String(NUMBER_GUESS_RANGE),
  }) as HTMLInputElement;
  const submitBtn = el("button", { class: "glass-button accent" }, ["Submit"]);
  const doSubmit = () => {
    const n = Number(input.value);
    if (input.value === "" || Number.isNaN(n)) return;
    submit(15, { type: "input:text", text: input.value, ts: Date.now() });
  };
  submitBtn.addEventListener("click", doSubmit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && doSubmit());
  ctx.root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:0.8em" }, [
      el("h2", { class: "title-md" }, [payload.prompt]),
      el("p", { class: "text-caption" }, [`Guess a number between 0 and ${NUMBER_GUESS_RANGE}`]),
      input,
      submitBtn,
    ]),
  );
  setTimeout(() => input.focus(), 50);
};
