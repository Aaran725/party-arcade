import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { vibrate } from "../../input/haptics";

const CHOICE_COLORS = ["#FF375F", "#0A84FF", "#30D158", "#FFD60A"];

type ResultPayload = { type: "reaction-result"; correct: boolean };

const FLASH_MS = 600;

export class TriviaBuzzerController implements ControllerGameModule {
  id = "trivia-buzzer" as const;

  private panel: HTMLElement | null = null;

  init(ctx: ControllerGameContext): void {
    const buttons = CHOICE_COLORS.map((color, i) => {
      const btn = el("button", { class: "buzzer-btn", style: `background:${color}` }, [String(i)]);
      btn.addEventListener("pointerdown", () => {
        vibrate(15);
        ctx.sendInput({ type: "input:button", buttonId: String(i), pressed: true, ts: Date.now() });
      });
      return btn;
    });

    this.panel = el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("p", { class: "text-caption" }, ["Tap the color matching your answer on screen"]),
      el("div", { class: "button-grid", style: "grid-template-columns:repeat(2,1fr)" }, buttons),
    ]);
    ctx.root.replaceChildren(this.panel);
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as ResultPayload;
    if (payload.type !== "reaction-result") return;
    vibrate(payload.correct ? 20 : 10);
    this.panel?.classList.add(payload.correct ? "flash-correct" : "flash-wrong");
    setTimeout(() => this.panel?.classList.remove("flash-correct", "flash-wrong"), FLASH_MS);
  }

  destroy(): void {}
}
