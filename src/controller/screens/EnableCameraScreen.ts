import { el } from "@shared/dom";
import { requestCameraStream, stopStream } from "../input/camera-capture";
import { vibrate } from "../input/haptics";

export function renderEnableCameraScreen(root: HTMLElement, opts: { gameTitle: string; onGranted: () => void }): void {
  const btn = el("button", { class: "glass-button accent" }, ["Enable camera"]);
  const status = el("p", { class: "text-body" }, []);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const stream = await requestCameraStream();
    if (stream) {
      stopStream(stream); // just probing for the grant — the game requests its own stream when it needs the live preview
      vibrate(20);
      opts.onGranted();
    } else {
      status.textContent = "Camera access denied — enable it in Settings → Safari → Camera, then reload.";
      status.classList.add("anim-shake");
      btn.disabled = false;
    }
  });

  root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("h2", { class: "title-md" }, [opts.gameTitle]),
      el("p", { class: "text-body" }, ["This game uses your phone's camera. Photos only go to the TV and other players — never off this network."]),
      btn,
      status,
    ]),
  );
}
