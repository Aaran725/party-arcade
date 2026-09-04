import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { onOrientation } from "../../input/motion";
import { vibrate } from "../../input/haptics";
import { flashCalibrateConfirm } from "../../components/feedback";

const SEND_INTERVAL_MS = 1000 / 45;
// How many degrees of tilt reach the edge of the gauge — purely visual, doesn't affect
// the actual (unclamped) input sent via input:tilt.
const GAUGE_RANGE_DEG = 30;
// A player is still adjusting their grip in the instant a game mounts — capturing
// baseline on the very first orientation sample bakes in whatever half-settled position
// they happened to be holding at that exact millisecond. This gives them a beat to
// actually get comfortable before "neutral" gets locked in.
const HOLD_STILL_MS = 900;

export class TiltMazeController implements ControllerGameModule {
  id = "tilt-maze" as const;
  private unsubscribe: (() => void) | null = null;
  private baseline: { beta: number; gamma: number } | null = null;
  private lastSend = 0;
  private gaugeDot: HTMLElement | null = null;

  init(ctx: ControllerGameContext): void {
    this.gaugeDot = el("div", { class: "tilt-gauge-dot" });
    const gauge = el("div", { class: "tilt-gauge" }, [this.gaugeDot]);
    const status = el("p", { class: "text-body" }, ["Hold still — finding your neutral position…"]);

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Tilt to roll"]),
        status,
        gauge,
      ]),
    );

    let readyToCalibrate = false;
    setTimeout(() => {
      readyToCalibrate = true;
    }, HOLD_STILL_MS);

    this.unsubscribe = onOrientation((beta, gamma) => {
      if (!this.baseline) {
        if (!readyToCalibrate) return; // ignore samples during the "hold still" window — don't lock in a mid-fumble grip as neutral
        this.baseline = { beta, gamma };
        vibrate(20);
        flashCalibrateConfirm(gauge);
        status.textContent = "Tilt your phone to roll — this is your neutral position now.";
        return;
      }
      const dBeta = beta - this.baseline.beta;
      const dGamma = gamma - this.baseline.gamma;

      const clampedX = Math.max(-1, Math.min(1, dGamma / GAUGE_RANGE_DEG));
      const clampedY = Math.max(-1, Math.min(1, dBeta / GAUGE_RANGE_DEG));
      if (this.gaugeDot) {
        this.gaugeDot.style.transform = `translate(calc(-50% + ${clampedX * 50}%), calc(-50% + ${clampedY * 50}%))`;
      }

      const now = performance.now();
      if (now - this.lastSend < SEND_INTERVAL_MS) return;
      this.lastSend = now;
      ctx.sendInput({ type: "input:tilt", beta: dBeta, gamma: dGamma, ts: Date.now() });
    });
  }

  onServerMessage(_msg: ServerToClientMessage): void {}

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.baseline = null;
    this.gaugeDot = null;
  }
}
