import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { onShake } from "../../input/motion";
import { vibrate } from "../../input/haptics";
import { renderAnsweredCard } from "../../components/answeredCard";

type Payload = { holding: boolean; exploded?: boolean; loserId?: string };

export class HotPotatoController implements ControllerGameModule {
  id = "hot-potato" as const;

  private ctx: ControllerGameContext | null = null;
  private unsubscribeShake: (() => void) | null = null;
  private meterFill: HTMLElement | null = null;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderWaiting();
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as Payload;
    if (payload.exploded) {
      this.renderExploded(payload.loserId === this.ctx!.playerId);
      return;
    }
    if (payload.holding) this.renderHolding();
    else this.renderWaiting();
  }

  private stopShakeListener(): void {
    this.unsubscribeShake?.();
    this.unsubscribeShake = null;
  }

  private renderWaiting(): void {
    this.stopShakeListener();
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-fade-in", style: "align-items:center" }, [
        el("div", { style: "font-size:2.6rem" }, ["🥔"]),
        el("h2", { class: "title-md" }, ["Someone else has it"]),
        el("p", { class: "text-body" }, ["Relax — but be ready. It could come your way any moment."]),
      ]),
    );
  }

  private renderHolding(): void {
    const ctx = this.ctx!;
    const meterFill = el("div", {
      style: "width:100%;height:0%;background:linear-gradient(0deg,#FF9F0A,#FF453A);border-radius:12px;transition:height 60ms linear",
    });
    this.meterFill = meterFill;

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
        el("div", { style: "font-size:2.6rem" }, ["🔥🥔"]),
        el("h2", { class: "title-md" }, ["YOU HAVE IT — SHAKE!"]),
        el("p", { class: "text-body" }, ["Shake your phone hard to pass it on before it blows."]),
        el(
          "div",
          { class: "mic-meter-track", style: "width:100%;height:120px;border-radius:12px;display:flex;align-items:flex-end;overflow:hidden" },
          [meterFill],
        ),
      ]),
    );

    this.stopShakeListener();
    this.unsubscribeShake = onShake({
      onIntensity: (level) => {
        if (this.meterFill) this.meterFill.style.height = `${Math.round(level * 100)}%`;
      },
      onShake: () => {
        vibrate(20);
        ctx.sendInput({ type: "input:tap", ts: Date.now() });
      },
    });
  }

  // No client-side timer to revert this screen — the Display's own reveal phase always
  // ends with the next round's startRound() broadcasting a fresh {holding} message to
  // everyone, so the next onServerMessage naturally replaces this. A local timeout here
  // would risk racing that and stomping a legitimate "you're holding it now" render.
  private renderExploded(youLost: boolean): void {
    this.stopShakeListener();
    vibrate(youLost ? [30, 60, 30] : 15);
    renderAnsweredCard(this.ctx!.root, {
      icon: youLost ? "💥" : "😅",
      label: youLost ? "You got caught!" : "Phew, not you!",
      sub: youLost ? "No points this round." : "Check the big screen for who was holding it.",
    });
  }

  destroy(): void {
    this.stopShakeListener();
  }
}
