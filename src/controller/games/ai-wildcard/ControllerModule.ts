import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage, WildcardMechanic } from "@shared/protocol/messages";
import { vibrate } from "../../input/haptics";
import { renderAnsweredCard } from "../../components/answeredCard";
import { onCompassHeading } from "../../input/motion";

const MAX_TYPE_LEN = 60;
// How close the live heading needs to render as "on target" — purely a visual cue, the
// real scoring (server-side, circular distance to the hidden target) doesn't use this.
const AIM_CLOSE_DEG = 15;

type Payload = {
  mechanic: WildcardMechanic;
  prompt: string;
  choices?: [string, string];
  candidates: { id: string; name: string }[];
  targetHeading?: number;
};

export class AiWildcardController implements ControllerGameModule {
  id = "ai-wildcard" as const;

  private ctx: ControllerGameContext | null = null;
  private answered = false;
  private unsubscribeCompass: (() => void) | null = null;

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
    const payload = msg.payload as Payload;
    this.answered = false;
    this.unsubscribeCompass?.();
    this.unsubscribeCompass = null;
    switch (payload.mechanic) {
      case "vote": this.renderVote(payload); break;
      case "type": this.renderType(payload); break;
      case "fast-tap": this.renderFastTap(payload); break;
      case "would-you-rather": this.renderWouldYouRather(payload); break;
      case "aim": this.renderAim(payload); break;
    }
  }

  private renderVote(payload: Payload): void {
    const ctx = this.ctx!;
    const others = payload.candidates.filter((c) => c.id !== ctx.playerId);
    const cards = others.map((c) => {
      const card = el("div", { class: "glass-card game-card anim-pop-in", style: "align-items:center;justify-content:center" }, [
        el("span", { class: "text-body" }, [c.name]),
      ]);
      card.addEventListener("click", () => {
        if (this.answered) return;
        this.answered = true;
        vibrate(15);
        ctx.sendInput({ type: "input:button", buttonId: c.id, pressed: true, ts: Date.now() });
        this.renderSubmitted();
      });
      return card;
    });
    ctx.root.replaceChildren(
      el("div", { style: "width:100%" }, [
        el("div", { class: "screen-header" }, [el("h2", { class: "title-md" }, [payload.prompt])]),
        el("div", { class: "vote-grid" }, cards),
      ]),
    );
  }

  private renderType(payload: Payload): void {
    const ctx = this.ctx!;
    const input = el("input", { class: "glass-input", placeholder: "Type your answer…", maxlength: MAX_TYPE_LEN }) as HTMLInputElement;
    const counter = el("p", { class: "text-caption", style: "align-self:flex-end" }, [`0/${MAX_TYPE_LEN}`]);
    input.addEventListener("input", () => {
      counter.textContent = `${input.value.length}/${MAX_TYPE_LEN}`;
    });
    const submitBtn = el("button", { class: "glass-button accent" }, ["Submit"]);
    const submit = () => {
      const text = input.value.trim();
      if (!text || this.answered) return;
      this.answered = true;
      vibrate(15);
      ctx.sendInput({ type: "input:text", text, ts: Date.now() });
      this.renderSubmitted();
    };
    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:0.8em" }, [
        el("h2", { class: "title-md" }, [payload.prompt]),
        input,
        counter,
        submitBtn,
      ]),
    );
    setTimeout(() => input.focus(), 50);
  }

  private renderFastTap(payload: Payload): void {
    const ctx = this.ctx!;
    const btn = el("button", { class: "buzzer-btn", style: "background:linear-gradient(160deg,#FFD60A,#FF9F0A);width:100%;aspect-ratio:1;font-size:1.6rem" }, ["TAP!"]);
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.answered) return;
      this.answered = true;
      vibrate(20);
      ctx.sendInput({ type: "input:button", buttonId: "tap", pressed: true, ts: Date.now() });
      this.renderSubmitted();
    });
    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
        el("h2", { class: "title-md" }, [payload.prompt]),
        btn,
      ]),
    );
  }

  private renderWouldYouRather(payload: Payload): void {
    const ctx = this.ctx!;
    const [optA, optB] = payload.choices ?? ["Option A", "Option B"];
    const pick = (choiceId: "A" | "B") => {
      if (this.answered) return;
      this.answered = true;
      vibrate(15);
      ctx.sendInput({ type: "input:button", buttonId: choiceId, pressed: true, ts: Date.now() });
      this.renderSubmitted();
    };
    const btnA = el("button", { class: "glass-button accent" }, [optA]);
    btnA.addEventListener("click", () => pick("A"));
    const btnB = el("button", { class: "glass-button accent" }, [optB]);
    btnB.addEventListener("click", () => pick("B"));
    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
        el("h2", { class: "title-md" }, [payload.prompt]),
        btnA,
        btnB,
      ]),
    );
  }

  private renderAim(payload: Payload): void {
    const ctx = this.ctx!;
    const target = payload.targetHeading ?? 0;
    let currentHeading = 0;

    const headingLabel = el("div", { class: "title-lg mono" }, ["--°"]);
    const status = el("p", { class: "text-caption" }, ["Turn your body until you're pointing the right way"]);
    const lockBtn = el("button", { class: "glass-button accent" }, ["🎯 Lock In!"]);

    lockBtn.addEventListener("click", () => {
      if (this.answered) return;
      this.answered = true;
      vibrate(15);
      this.unsubscribeCompass?.();
      this.unsubscribeCompass = null;
      ctx.sendInput({ type: "input:button", buttonId: String(Math.round(currentHeading)), pressed: true, ts: Date.now() });
      this.renderSubmitted();
    });

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:1em" }, [
        el("h2", { class: "title-md" }, [payload.prompt]),
        headingLabel,
        status,
        lockBtn,
      ]),
    );

    this.unsubscribeCompass = onCompassHeading((heading) => {
      currentHeading = heading;
      headingLabel.textContent = `${Math.round(heading)}°`;
      const diff = Math.abs(heading - target);
      const distance = Math.min(diff, 360 - diff);
      headingLabel.style.color = distance <= AIM_CLOSE_DEG ? "var(--accent-success)" : "var(--text-0)";
    });
  }

  private renderSubmitted(): void {
    renderAnsweredCard(this.ctx!.root, { icon: "🔒", label: "Locked in!", sub: "Check the big screen for the results…" });
  }

  destroy(): void {
    this.unsubscribeCompass?.();
    this.unsubscribeCompass = null;
  }
}
