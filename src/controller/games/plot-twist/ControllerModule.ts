import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { vibrate } from "../../input/haptics";
import { renderAnsweredCard } from "../../components/answeredCard";

const MAX_RESPONSE_LEN = 120;

type RoundStartPayload = { scenario: string };
type VotePayload = { phase: "vote"; responses: { playerId: string; text: string }[] };
type Payload = RoundStartPayload | VotePayload;

export class PlotTwistController implements ControllerGameModule {
  id = "plot-twist" as const;

  private ctx: ControllerGameContext | null = null;
  private submittedThisRound = false;
  private votedThisRound = false;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderWaiting();
  }

  private renderWaiting(): void {
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Get ready…"]),
        el("p", { class: "text-body" }, ["An AI is about to make something up."]),
      ]),
    );
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as Payload;
    if ("scenario" in payload) this.renderRespond(payload.scenario);
    else this.renderVote(payload);
  }

  private renderRespond(scenario: string): void {
    this.submittedThisRound = false;
    // Each round starts with a fresh scenario broadcast, so this is the right place to
    // re-arm voting too — without it, this stayed true from round 1 forever, and
    // renderVote()'s `if (this.votedThisRound) return;` silently blocked every later
    // round's vote screen from ever rendering for anyone who had voted at all.
    this.votedThisRound = false;
    const ctx = this.ctx!;
    const textarea = el("textarea", {
      class: "glass-input",
      placeholder: "Type your response…",
      maxlength: MAX_RESPONSE_LEN,
      rows: 3,
    }) as HTMLTextAreaElement;
    const counter = el("p", { class: "text-caption", style: "align-self:flex-end" }, [`0/${MAX_RESPONSE_LEN}`]);
    textarea.addEventListener("input", () => {
      counter.textContent = `${textarea.value.length}/${MAX_RESPONSE_LEN}`;
    });
    const submitBtn = el("button", { class: "glass-button accent" }, ["Submit"]);

    const submit = () => {
      const text = textarea.value.trim();
      if (!text || this.submittedThisRound) return;
      this.submittedThisRound = true;
      vibrate(15);
      ctx.sendInput({ type: "input:text", text, ts: Date.now() });
      this.renderSubmitted();
    };
    submitBtn.addEventListener("click", submit);
    // Enter submits (Shift+Enter still inserts a newline) — matches ai-wildcard's `type`
    // mechanic input, which already submits on Enter; this textarea didn't.
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:0.8em" }, [
        el("p", { class: "text-caption" }, ["The scenario"]),
        el("p", { class: "text-body" }, [scenario]),
        textarea,
        counter,
        submitBtn,
      ]),
    );
    setTimeout(() => textarea.focus(), 50);
  }

  private renderSubmitted(): void {
    renderAnsweredCard(this.ctx!.root, { icon: "✍️", label: "Response submitted", sub: "Waiting for everyone else…" });
  }

  private renderVote(payload: VotePayload): void {
    if (this.votedThisRound) return;
    const ctx = this.ctx!;
    const others = payload.responses.filter((r) => r.playerId !== ctx.playerId);
    const cards = others.map((r) => {
      const card = el("div", { class: "glass-card game-card anim-pop-in", style: "align-items:center;justify-content:center;padding:1em;text-align:center" }, [
        el("p", { class: "text-body" }, [r.text]),
      ]);
      card.addEventListener("click", () => {
        if (this.votedThisRound) return;
        this.votedThisRound = true;
        vibrate(15);
        ctx.sendInput({ type: "input:button", buttonId: r.playerId, pressed: true, ts: Date.now() });
        this.renderVotedConfirm();
      });
      return card;
    });

    ctx.root.replaceChildren(
      // width:100% — see the identical note in sleeper-agent's ControllerModule: an
      // unstyled wrapper shrink-to-fits inside #app's centered flex column, collapsing
      // the grid below its own track minimum with sparse content.
      el("div", { style: "width:100%" }, [
        el("div", { class: "screen-header" }, [el("h2", { class: "title-md" }, ["Vote for the funniest"])]),
        el("div", { class: "vote-grid" }, cards),
      ]),
    );
  }

  private renderVotedConfirm(): void {
    renderAnsweredCard(this.ctx!.root, { icon: "🗳️", label: "Vote submitted", sub: "Waiting for the results…" });
  }

  destroy(): void {}
}
