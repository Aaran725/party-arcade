import { el } from "@shared/dom";
import { POINTER_SEND_HZ } from "@shared/protocol/constants";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { PointerCalibration } from "../../input/pointer-calibration";
import { mountReticle } from "../../input/reticle";
import { onPinchSpread } from "../../input/pinch";
import { vibrate } from "../../input/haptics";
import { flashCalibrateConfirm } from "../../components/feedback";

const SEND_INTERVAL_MS = 1000 / POINTER_SEND_HZ;
// A beat to actually get comfortable before "neutral" gets locked in — capturing baseline
// the instant the game mounts bakes in whatever half-settled grip the player happened to
// be holding at that exact millisecond.
const HOLD_STILL_MS = 900;

export class PaintWarsController implements ControllerGameModule {
  id = "paint-wars" as const;
  private calibration = new PointerCalibration();
  private lastSend = 0;
  private unsubscribe: (() => void) | null = null;
  private unmountReticle: (() => void) | null = null;
  private unsubscribePinch: (() => void) | null = null;
  private calibrateTimer = 0;

  init(ctx: ControllerGameContext): void {
    const recenterBtn = el("button", { class: "glass-button recenter-btn" }, ["Recenter"]);
    recenterBtn.addEventListener("click", () => {
      this.calibration.recalibrate();
      vibrate(20);
      flashCalibrateConfirm(recenterBtn);
    });

    const status = el("p", { class: "text-body" }, ["Hold still — finding your neutral position…"]);
    const panel = el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("h2", { class: "title-md" }, ["Paint Wars"]),
      status,
      el("p", { class: "text-caption" }, ["Spread two fingers on the screen for a burst of extra reach"]),
    ]);
    ctx.root.replaceChildren(panel, recenterBtn);

    // document.body, not ctx.root — the gesture should work with fingers anywhere on the
    // screen while playing, not just over the (fairly small) instructions panel.
    this.unsubscribePinch = onPinchSpread(document.body, () => {
      vibrate(20);
      flashCalibrateConfirm(panel);
      ctx.sendInput({ type: "input:button", buttonId: "pinch-boost", pressed: true, ts: Date.now() });
    });

    this.calibration.start();
    this.calibrateTimer = window.setTimeout(() => {
      this.calibration.calibrate();
      vibrate(20);
      flashCalibrateConfirm(panel);
      status.textContent = "Point to paint the floor. Claim the most territory.";
    }, HOLD_STILL_MS);
    this.unmountReticle = mountReticle(this.calibration);
    this.unsubscribe = this.calibration.onUpdate((x, y) => {
      const now = performance.now();
      if (now - this.lastSend < SEND_INTERVAL_MS) return;
      this.lastSend = now;
      ctx.sendInput({ type: "input:pointer", x, y, ts: Date.now() });
    });
  }

  onServerMessage(_msg: ServerToClientMessage): void {}

  destroy(): void {
    clearTimeout(this.calibrateTimer);
    this.unsubscribe?.();
    this.unmountReticle?.();
    this.unsubscribePinch?.();
    this.calibration.destroy();
  }
}
