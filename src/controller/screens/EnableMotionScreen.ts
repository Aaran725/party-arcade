import { el } from "@shared/dom";
import { requestMotionPermission } from "../input/motion";
import { vibrate } from "../input/haptics";

export function renderEnableMotionScreen(
  root: HTMLElement,
  opts: { gameTitle: string; onGranted: () => void },
): void {
  const btn = el("button", { class: "glass-button accent" }, ["Enable motion"]);
  const status = el("p", { class: "text-body" }, []);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const granted = await requestMotionPermission();
    if (granted) {
      vibrate(20);
      opts.onGranted();
    } else {
      status.textContent = "Motion access denied — enable it in Settings → Safari → Motion & Orientation Access, then reload.";
      status.classList.add("anim-shake");
      btn.disabled = false;
    }
  });

  root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("h2", { class: "title-md" }, [opts.gameTitle]),
      el("p", { class: "text-body" }, ["This game uses your phone's motion sensors."]),
      btn,
      status,
    ]),
  );
}
