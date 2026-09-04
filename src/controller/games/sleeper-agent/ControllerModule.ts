import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { createAvatarSvg } from "@shared/avatar";
import { vibrate } from "../../input/haptics";
import { renderAnsweredCard } from "../../components/answeredCard";

interface RosterPlayer {
  id: string;
  name: string;
  color: string;
}

type RevealPayload =
  | { phase: "reveal"; role: "agent"; category: string }
  | { phase: "reveal"; role: "civilian"; word: string; category: string };
type VotePayload = { phase: "vote"; players: RosterPlayer[] };
type RedemptionPayload = { phase: "redemption"; choices: string[] };
type Payload = RevealPayload | VotePayload | RedemptionPayload;

export class SleeperAgentController implements ControllerGameModule {
  id = "sleeper-agent" as const;

  private ctx: ControllerGameContext | null = null;
  private votedThisRound = false;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderWaiting();
  }

  private renderWaiting(): void {
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Get ready…"]),
        el("p", { class: "text-body" }, ["Waiting for the round to start."]),
      ]),
    );
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as Payload;
    if (payload.phase === "reveal") this.renderReveal(payload);
    else if (payload.phase === "vote") this.renderVote(payload);
    else if (payload.phase === "redemption") this.renderRedemption(payload);
  }

  private renderReveal(payload: RevealPayload): void {
    this.votedThisRound = false;
    const ctx = this.ctx!;
    if (payload.role === "agent") {
      vibrate([30, 60, 30]);
      ctx.root.replaceChildren(
        el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;border-color:#FF453A" }, [
          el("h2", { class: "title-md", style: "color:#FF453A" }, ["You are the Agent"]),
          el("p", { class: "text-caption" }, ["Category"]),
          el("p", { class: "title-lg" }, [payload.category]),
          el("p", { class: "text-body" }, [
            "You don't know the word — listen and bluff your way through the discussion. If the group votes you out, they score; if you're not caught, you do. Either way, you'll get one final guess at the word for bonus points.",
          ]),
        ]),
      );
    } else {
      vibrate(15);
      ctx.root.replaceChildren(
        el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
          el("h2", { class: "title-md" }, ["You are a Civilian"]),
          el("p", { class: "text-caption" }, ["Category"]),
          el("p", { class: "title-md" }, [payload.category]),
          el("p", { class: "text-caption" }, ["Word"]),
          el("p", { class: "title-lg" }, [payload.word]),
          el("p", { class: "text-body" }, [
            "Describe it out loud without saying it — one player doesn't know the word and is bluffing. Vote them out to score.",
          ]),
        ]),
      );
    }
  }

  private renderVote(payload: VotePayload): void {
    if (this.votedThisRound) return;
    const ctx = this.ctx!;
    const others = payload.players.filter((p) => p.id !== ctx.playerId);
    const cards = others.map((p) => {
      const card = el("div", { class: "glass-card game-card anim-pop-in", style: "align-items:center;justify-content:center" }, [
        createAvatarSvg(p.id, p.color, { size: "2.4em" }),
        el("span", { class: "text-body" }, [p.name]),
      ]);
      card.addEventListener("click", () => {
        if (this.votedThisRound) return;
        this.votedThisRound = true;
        vibrate(15);
        ctx.sendInput({ type: "input:button", buttonId: p.id, pressed: true, ts: Date.now() });
        this.renderVotedConfirm();
      });
      return card;
    });

    ctx.root.replaceChildren(
      // width:100% — without it this wrapper shrink-to-fits inside #app's centered flex
      // column, and with sparse content (avatar + name only) that collapses the grid
      // below even its own minmax() track minimum instead of stretching to the viewport.
      el("div", { style: "width:100%" }, [
        el("div", { class: "screen-header" }, [el("h2", { class: "title-md" }, ["Who's the Agent?"])]),
        el("div", { class: "vote-grid" }, cards),
      ]),
    );
  }

  private renderVotedConfirm(): void {
    renderAnsweredCard(this.ctx!.root, { icon: "🗳️", label: "Vote submitted", sub: "Waiting for the results…" });
  }

  private renderRedemption(payload: RedemptionPayload): void {
    const ctx = this.ctx!;
    const buttons = payload.choices.map((choice, i) => {
      const btn = el("button", { class: "glass-button accent" }, [choice]);
      btn.addEventListener("click", () => {
        vibrate(15);
        ctx.sendInput({ type: "input:button", buttonId: String(i), pressed: true, ts: Date.now() });
        renderAnsweredCard(ctx.root, { icon: "🎯", label: `Final guess: ${choice}`, sub: "Waiting for the results…" });
      });
      return btn;
    });
    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Final guess — what's the word?"]),
        ...buttons,
      ]),
    );
  }

  destroy(): void {}
}
