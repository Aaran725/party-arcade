import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { renderEnableMicScreen } from "../../screens/EnableMicScreen";
import { MicLevelCapture } from "../../input/mic-level";

const SEND_INTERVAL_MS = 100; // ~10Hz — plenty for a live meter, cheap on the wire
const RESULT_TOAST_MS = 2600;
const AMBIENT_CALIBRATE_MS = 1500;

type ResultPayload = { type: "scream-result"; rank: number; points: number; peak: number };

export class ScreamRoyaleController implements ControllerGameModule {
  id = "scream-royale" as const;

  private ctx: ControllerGameContext | null = null;
  private capture: MicLevelCapture | null = null;
  private lastSentAt = 0;
  private meterFill: HTMLElement | null = null;
  private resultToast: HTMLElement | null = null;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    renderEnableMicScreen(ctx.root, {
      gameTitle: "Scream Royale",
      onGranted: () => this.startCapturing(),
    });
  }

  // Streams continuously for the whole game rather than syncing to the display's
  // round timer — the display already ignores levels outside its "active" phase, and
  // a single throttled number over the wire is cheap enough that precise on/off
  // synchronization isn't worth the extra private-message plumbing.
  private startCapturing(): void {
    const ctx = this.ctx!;
    this.capture = new MicLevelCapture();

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
        el("h2", { class: "title-md" }, ["🤫 Measuring room noise…"]),
        el("p", { class: "text-body" }, ["Stay quiet for a second — this keeps a loud room from having an unfair advantage."]),
      ]),
    );

    void this.capture.calibrateAmbient(AMBIENT_CALIBRATE_MS).then(() => this.renderMeter());
  }

  private renderMeter(): void {
    const ctx = this.ctx!;
    const meterFill = el("div", {
      style: "width:100%;height:0%;background:linear-gradient(0deg,#FF453A,#FFD60A);border-radius:12px;transition:height 60ms linear",
    });
    this.meterFill = meterFill;

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
        el("h2", { class: "title-md" }, ["🎤 Scream into your phone!"]),
        el("p", { class: "text-body" }, ["Watch the big screen for the prompt and countdown."]),
        el(
          "div",
          { class: "mic-meter-track", style: "width:100%;height:220px;border-radius:12px;display:flex;align-items:flex-end;overflow:hidden" },
          [meterFill],
        ),
      ]),
    );

    this.capture?.beginStreaming((level) => {
      if (this.meterFill) this.meterFill.style.height = `${level}%`;
      const now = Date.now();
      if (now - this.lastSentAt >= SEND_INTERVAL_MS) {
        this.lastSentAt = now;
        ctx.sendInput({ type: "input:mic_level", level, ts: now });
      }
    });
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as ResultPayload;
    if (payload.type !== "scream-result") return;
    this.resultToast?.remove();
    this.resultToast = el(
      "div",
      { class: "glass-panel anim-pop-in", style: "position:fixed;top:max(4em, env(safe-area-inset-top));left:1em;right:1em;z-index:15;padding:0.8em 1em;text-align:center" },
      [el("p", { class: "text-body" }, [payload.rank === 1 ? `🏆 Loudest! +${payload.points}` : `#${payload.rank} place — +${payload.points}`])],
    );
    document.body.append(this.resultToast);
    setTimeout(() => {
      this.resultToast?.remove();
      this.resultToast = null;
    }, RESULT_TOAST_MS);
  }

  destroy(): void {
    this.capture?.stop();
    this.capture = null;
    this.resultToast?.remove();
    this.resultToast = null;
  }
}
