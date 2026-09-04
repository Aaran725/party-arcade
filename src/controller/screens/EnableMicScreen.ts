import { el } from "@shared/dom";
import { requestMicPermission } from "../input/mic-level";
import { vibrate } from "../input/haptics";

export function renderEnableMicScreen(root: HTMLElement, opts: { gameTitle: string; onGranted: () => void }): void {
  const btn = el("button", { class: "glass-button accent" }, ["Enable microphone"]);
  const status = el("p", { class: "text-body" }, []);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const granted = await requestMicPermission();
    if (granted) {
      vibrate(20);
      opts.onGranted();
    } else {
      status.textContent = "Microphone access denied — enable it in Settings → Safari → Microphone, then reload.";
      status.classList.add("anim-shake");
      btn.disabled = false;
    }
  });

  root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("h2", { class: "title-md" }, [opts.gameTitle]),
      el("p", { class: "text-body" }, ["This game uses your phone's microphone — only a loudness number is ever sent, never audio."]),
      btn,
      status,
    ]),
  );
}
