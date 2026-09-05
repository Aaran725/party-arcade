import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { InputMessage, ServerToClientMessage } from "@shared/protocol/messages";
import { vibrate } from "../../input/haptics";
import { renderAnsweredCard } from "../../components/answeredCard";
import { WILDCARD_CONTROLLER_MECHANICS, type WildcardPayload } from "./mechanics";
import { el } from "@shared/dom";

export class AiWildcardController implements ControllerGameModule {
  id = "ai-wildcard" as const;

  private ctx: ControllerGameContext | null = null;
  private answered = false;
  private cleanup: (() => void) | null = null;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderWaiting();
  }

  private renderWaiting(): void {
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Get ready…"]),
        el("p", { class: "text-body" }, ["An AI is inventing a mini-game right now."]),
      ]),
    );
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as WildcardPayload;
    this.answered = false;
    this.cleanup?.();
    this.cleanup = null;

    const ctx = this.ctx!;
    const submit = (vibrateMs: number, inputMsg: InputMessage) => {
      if (this.answered) return;
      this.answered = true;
      vibrate(vibrateMs);
      this.cleanup?.();
      this.cleanup = null;
      ctx.sendInput(inputMsg);
      this.renderSubmitted();
    };

    const renderer = WILDCARD_CONTROLLER_MECHANICS[payload.mechanic];
    this.cleanup = renderer({ ctx, payload, submit }) ?? null;
  }

  private renderSubmitted(): void {
    renderAnsweredCard(this.ctx!.root, { icon: "🔒", label: "Locked in!", sub: "Check the big screen for the results…" });
  }

  destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
  }
}
