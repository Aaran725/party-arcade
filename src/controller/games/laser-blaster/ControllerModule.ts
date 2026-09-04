import { el } from "@shared/dom";
import { POINTER_SEND_HZ } from "@shared/protocol/constants";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { PointerCalibration } from "../../input/pointer-calibration";
import { mountReticle } from "../../input/reticle";
import { vibrate } from "../../input/haptics";
import { spawnTouchRipple, flashCalibrateConfirm } from "../../components/feedback";

const SEND_INTERVAL_MS = 1000 / POINTER_SEND_HZ;
// A beat to actually get comfortable before "neutral" gets locked in — capturing baseline
// the instant the game mounts bakes in whatever half-settled grip the player happened to
// be holding at that exact millisecond.
const HOLD_STILL_MS = 900;

export class LaserBlasterController implements ControllerGameModule {
  id = "laser-blaster" as const;
  private calibration = new PointerCalibration();
  private lastSend = 0;
  private unsubscribe: (() => void) | null = null;
  private unmountReticle: (() => void) | null = null;
  private calibrateTimer = 0;

  init(ctx: ControllerGameContext): void {
    const tapZone = el("div", { class: "full-tap-zone" });
    tapZone.addEventListener("pointerdown", (e) => {
      vibrate(10);
      spawnTouchRipple(e.clientX, e.clientY);
      ctx.sendInput({ type: "input:tap", ts: Date.now() });
    });

    const recenterBtn = el("button", { class: "glass-button recenter-btn" }, ["Recenter"]);
    recenterBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.calibration.recalibrate();
      vibrate(20);
      flashCalibrateConfirm(recenterBtn);
    });

    const status = el("p", { class: "text-body" }, ["Hold still — finding your neutral position…"]);
    const panel = el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("h2", { class: "title-md" }, ["Laser Blaster"]),
      status,
    ]);
    ctx.root.replaceChildren(panel, tapZone, recenterBtn);

    this.calibration.start();
    this.calibrateTimer = window.setTimeout(() => {
      this.calibration.calibrate();
      vibrate(20);
      flashCalibrateConfirm(panel);
      status.textContent = "Point at the screen, tap anywhere to fire.";
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
    this.calibration.destroy();
  }
}
