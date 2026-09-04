import { el } from "@shared/dom";
import { POINTER_SEND_HZ } from "@shared/protocol/constants";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { PointerCalibration } from "../../input/pointer-calibration";
import { mountReticle } from "../../input/reticle";
import { vibrate } from "../../input/haptics";
import { flashCalibrateConfirm } from "../../components/feedback";

const SEND_INTERVAL_MS = 1000 / POINTER_SEND_HZ;
// A beat to actually get comfortable before "neutral" gets locked in — capturing baseline
// the instant the game mounts bakes in whatever half-settled grip the player happened to
// be holding at that exact millisecond.
const HOLD_STILL_MS = 900;

type SliceResultPayload = { type: "slice-result"; bomb: boolean };

export class FruitSliceController implements ControllerGameModule {
  id = "fruit-slice" as const;
  private calibration = new PointerCalibration();
  private lastSend = 0;
  private unsubscribe: (() => void) | null = null;
  private unmountReticle: (() => void) | null = null;
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
      el("h2", { class: "title-md" }, ["Fruit Slice"]),
      status,
    ]);
    ctx.root.replaceChildren(panel, recenterBtn);

    this.calibration.start();
    this.calibrateTimer = window.setTimeout(() => {
      this.calibration.calibrate();
      vibrate(20);
      flashCalibrateConfirm(panel);
      status.textContent = "No swiping — just point at a fruit to slice it.";
    }, HOLD_STILL_MS);
    this.unmountReticle = mountReticle(this.calibration);
    this.unsubscribe = this.calibration.onUpdate((x, y) => {
      const now = performance.now();
      if (now - this.lastSend < SEND_INTERVAL_MS) return;
      this.lastSend = now;
      ctx.sendInput({ type: "input:pointer", x, y, ts: Date.now() });
    });
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as SliceResultPayload;
    if (payload.type !== "slice-result") return;
    vibrate(payload.bomb ? [30, 30, 30] : 10);
  }

  destroy(): void {
    clearTimeout(this.calibrateTimer);
    this.unsubscribe?.();
    this.unmountReticle?.();
    this.calibration.destroy();
  }
}
