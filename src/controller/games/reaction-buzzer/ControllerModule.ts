import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { vibrate } from "../../input/haptics";

const TILE_COLORS = [
  "#FF375F", "#0A84FF", "#30D158", "#FFD60A", "#BF5AF2", "#FF9F0A", "#64D2FF", "#FF6482", "#5E5CE6",
];

type ResultPayload = { type: "reaction-result"; correct: boolean };

const FLASH_MS = 600;

export class ReactionBuzzerController implements ControllerGameModule {
  id = "reaction-buzzer" as const;

  private ctx: ControllerGameContext | null = null;
  private panel: HTMLElement | null = null;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderGrid();
  }

  private renderGrid(): void {
    const ctx = this.ctx!;
    const buttons = TILE_COLORS.map((color, i) => {
      const btn = el("button", { class: "buzzer-btn", style: `background:${color}` }, [String(i)]);
      btn.addEventListener("pointerdown", () => {
        vibrate(15);
        ctx.sendInput({ type: "input:button", buttonId: String(i), pressed: true, ts: Date.now() });
      });
      return btn;
    });

    this.panel = el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("p", { class: "text-caption" }, ["Tap the tile that lights up on screen"]),
      el("div", { class: "button-grid" }, buttons),
    ]);
    ctx.root.replaceChildren(this.panel);
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as ResultPayload;
    if (payload.type !== "reaction-result") return;
    vibrate(payload.correct ? 20 : 10);
    this.panel?.classList.add(payload.correct ? "flash-correct" : "flash-wrong");
    setTimeout(() => {
      // A new round may have already re-rendered the grid (a fresh panel instance) by the
      // time this fires — only clear the flash off the panel it was actually applied to.
      this.panel?.classList.remove("flash-correct", "flash-wrong");
    }, FLASH_MS);
  }

  destroy(): void {}
}
