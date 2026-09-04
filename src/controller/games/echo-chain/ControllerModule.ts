import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { AudioRecorder, audioRecordingSupported } from "../../input/audio-recorder";
import { vibrate } from "../../input/haptics";
import { renderAnsweredCard } from "../../components/answeredCard";

const MAX_HOLD_MS = 8000;

type ActivePayload = { role: "active" };
type WaitingPayload = { role: "waiting"; activeName: string };
type EliminatedPayload = { role: "eliminated" };
type Payload = ActivePayload | WaitingPayload | EliminatedPayload;

export class EchoChainController implements ControllerGameModule {
  id = "echo-chain" as const;

  private ctx: ControllerGameContext | null = null;
  private recorder: AudioRecorder | null = null;
  // Promoted out of renderActive()'s local closure so destroy() can actually cancel a
  // pending auto-stop — otherwise it fires after teardown and calls stop() on a recorder
  // destroy() already nulled, throwing an unhandled rejection.
  private holdTimer = 0;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderWaiting();
  }

  private renderWaiting(): void {
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-fade-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Get ready…"]),
        el("p", { class: "text-body" }, ["The chain starts soon — watch the big screen."]),
      ]),
    );
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as Payload;
    if (payload.role === "active") this.renderActive();
    else if (payload.role === "waiting") this.renderWaitingForTurn(payload.activeName);
    else this.renderEliminated();
  }

  private renderActive(): void {
    const ctx = this.ctx!;

    if (!audioRecordingSupported()) {
      ctx.root.replaceChildren(
        el("div", { class: "glass-panel controller-panel anim-fade-in", style: "align-items:center" }, [
          el("h2", { class: "title-md" }, ["Your turn!"]),
          el("p", { class: "text-body" }, ["This device can't record audio — say your word out loud and have someone else confirm on the big screen."]),
        ]),
      );
      return;
    }

    this.recorder = new AudioRecorder();
    let recording = false;

    const btn = el("button", { class: "glass-button accent", style: "width:100%;padding:2.4em 1.2em;font-size:1.3rem" }, ["🎙️ Hold to speak"]);
    const progressFill = el("div", { class: "hold-progress-fill", style: `transition-duration:${MAX_HOLD_MS}ms` });
    const progress = el("div", { class: "hold-progress" }, [progressFill]);

    const resetProgress = () => {
      progressFill.style.transitionDuration = "0ms";
      progressFill.style.width = "0%";
      void progressFill.offsetWidth; // force the reflow so the next fill's transition actually animates instead of jumping
      progressFill.style.transitionDuration = `${MAX_HOLD_MS}ms`;
    };

    const finish = async () => {
      if (!recording) return;
      recording = false;
      clearTimeout(this.holdTimer);
      resetProgress();
      btn.disabled = true;
      btn.textContent = "Sending…";
      const audioData = await this.recorder!.stop();
      if (audioData) {
        ctx.sendInput({ type: "input:audio", audioData, ts: Date.now() });
        this.renderSent();
      } else {
        btn.disabled = false;
        btn.textContent = "🎙️ Hold to speak";
      }
    };

    const begin = async () => {
      if (recording) return;
      recording = true;
      vibrate(15);
      btn.textContent = "🔴 Recording… release to send";
      const ok = await this.recorder!.start();
      if (!ok) {
        recording = false;
        btn.disabled = true;
        btn.textContent = "Couldn't access the microphone";
        return;
      }
      progressFill.style.width = "100%";
      this.holdTimer = window.setTimeout(finish, MAX_HOLD_MS);
    };

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      void begin();
    });
    btn.addEventListener("pointerup", () => void finish());
    btn.addEventListener("pointercancel", () => void finish());

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-fade-in", style: "align-items:center;gap:1em" }, [
        el("h2", { class: "title-md" }, ["Your turn!"]),
        el("p", { class: "text-body" }, ["Hold the button, say a word, then let go."]),
        btn,
        progress,
      ]),
    );
  }

  private renderSent(): void {
    renderAnsweredCard(this.ctx!.root, { icon: "🎤", label: "Sent!", sub: "Check the big screen…" });
  }

  private renderWaitingForTurn(activeName: string): void {
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-fade-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, [`${activeName}'s turn`]),
        el("p", { class: "text-body" }, ["Watch the big screen — you're up soon."]),
      ]),
    );
  }

  private renderEliminated(): void {
    vibrate([20, 40, 20]);
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["You're out!"]),
        el("p", { class: "text-body" }, ["Keep watching — the chain continues without you."]),
      ]),
    );
  }

  destroy(): void {
    clearTimeout(this.holdTimer);
    // Dropping the reference alone never released the mic — stop() is what actually calls
    // stream.getTracks().forEach(t => t.stop()). Without it, destroying mid-recording (game
    // ends, host force-ends the round, a reconnect) left the OS mic-in-use indicator lit
    // with no way for the page to turn it off short of a full reload. Safe to call even if
    // never started (see AudioRecorder.stop()'s own inactive/null guard).
    void this.recorder?.stop();
    this.recorder = null;
  }
}
