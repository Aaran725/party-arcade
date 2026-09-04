import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { vibrate } from "../../input/haptics";
import { spawnTouchRipple } from "../../components/feedback";

type Candidate = { id: string; name: string };
type Payload =
  | { role: "battling"; opponent: string }
  | { role: "waiting"; predictCandidates?: Candidate[] }
  | { role: "eliminated"; predictCandidates?: Candidate[] }
  | { role: "champion" };

export class PushBattleController implements ControllerGameModule {
  id = "push-battle" as const;

  private ctx: ControllerGameContext | null = null;
  // Candidate-pair signature we've already predicted for — so re-renders of the same
  // match's waiting/eliminated screen don't keep re-offering the picker.
  private predictedKey: string | null = null;
  // Promoted out of renderBattle()'s local closure. If the round ends (a new private
  // message swaps the DOM) while the player still has a finger down, the button is removed
  // before a pointerup can ever reach it — implicit touch capture doesn't survive its
  // target leaving the DOM — so nothing would otherwise stop the requestAnimationFrame
  // mash loop, which then keeps sending "push" presses forever and silently feeds a
  // phantom advantage into whatever match this player is placed into next. Every render
  // path (and destroy()) calls stopMashing() first, so the loop always dies within one tick.
  private mashing = false;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderSpectator("Get ready…", "Waiting for the bracket to start.");
  }

  private stopMashing(): void {
    this.mashing = false;
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as Payload;
    if (payload.role === "battling") this.renderBattle(payload.opponent);
    else if (payload.role === "champion") this.renderChampion();
    else if (payload.role === "eliminated") this.renderSpectator("You're out", "Keep watching — the bracket continues without you.", payload.predictCandidates);
    else this.renderSpectator("Get ready…", "Waiting for your match.", payload.predictCandidates);
  }

  private renderSpectator(title: string, body: string, candidates?: Candidate[]): void {
    this.stopMashing();
    const ctx = this.ctx!;
    const key = candidates?.map((c) => c.id).join(",") ?? null;
    const alreadyPredicted = key !== null && key === this.predictedKey;

    const children: (Node | string)[] = [el("h2", { class: "title-md" }, [title]), el("p", { class: "text-body" }, [body])];
    if (candidates?.length === 2 && !alreadyPredicted) {
      children.push(el("p", { class: "text-caption" }, ["Who's going to win?"]));
      for (const c of candidates) {
        const btn = el("button", { class: "glass-button accent" }, [`Predict ${c.name}`]);
        btn.addEventListener("click", () => {
          vibrate(15);
          ctx.sendInput({ type: "input:prediction", targetPlayerId: c.id, ts: Date.now() });
          this.predictedKey = key;
          this.renderSpectator(title, body, candidates);
        });
        children.push(btn);
      }
    } else if (alreadyPredicted) {
      children.push(el("p", { class: "text-caption" }, ["Prediction locked in — +5 if you're right!"]));
    }
    ctx.root.replaceChildren(el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:0.6em" }, children));
  }

  private renderBattle(opponent: string): void {
    this.stopMashing();
    const ctx = this.ctx!;
    const btn = el("button", { class: "buzzer-btn", style: "background:linear-gradient(160deg,#FF453A,#BF5AF2);width:100%;aspect-ratio:1;font-size:2rem" }, ["PUSH!"]);

    const push = () => {
      vibrate(10);
      ctx.sendInput({ type: "input:button", buttonId: "push", pressed: true, ts: Date.now() });
    };

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // Belt-and-suspenders: keeps pointerup routed to this button even through a
      // relayout. The real fix is stopMashing() being called from every render path and
      // destroy() below, which stops the loop even if the button is removed outright.
      btn.setPointerCapture(e.pointerId);
      this.mashing = true;
      spawnTouchRipple(e.clientX, e.clientY);
      push();
      const loop = () => {
        if (!this.mashing) return;
        push();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    const release = () => this.stopMashing();
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-fade-in", style: "align-items:center;gap:1em" }, [
        el("h2", { class: "title-md" }, [`vs ${opponent}`]),
        el("p", { class: "text-body" }, ["Mash the button as fast as you can!"]),
        btn,
      ]),
    );
  }

  private renderChampion(): void {
    this.stopMashing();
    vibrate([30, 60, 30]);
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["🏆 You're the champion!"]),
      ]),
    );
  }

  destroy(): void {
    this.stopMashing();
  }
}
