import { el } from "@shared/dom";
import { vibrate } from "../input/haptics";
import { flashCalibrateConfirm } from "../components/feedback";

export function renderCalibrateScreen(
  root: HTMLElement,
  opts: { gameTitle: string; instructions: string; onCalibrate: () => void },
): void {
  const btn = el("button", { class: "glass-button accent" }, ["Calibrate"]);
  const status = el("p", { class: "text-caption" }, []);
  const panel = el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
    el("h2", { class: "title-md" }, [opts.gameTitle]),
    el("p", { class: "text-body" }, [opts.instructions]),
    btn,
    status,
  ]);

  btn.addEventListener("click", () => {
    opts.onCalibrate();
    vibrate(20);
    flashCalibrateConfirm(panel);
    btn.textContent = "Recalibrate";
    status.textContent = "Ready — waiting for host to start…";
  });

  root.replaceChildren(panel);
}
