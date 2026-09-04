import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { DrawCapture } from "../../input/draw-capture";
import { LocalStrokeCanvas } from "../../input/local-stroke-canvas";
import { vibrate } from "../../input/haptics";
import { renderAnsweredCard } from "../../components/answeredCard";
import { mountDrawToolbar } from "../../components/drawToolbar";

const DEFAULT_LINE_WIDTH = 5;
const CLEAR_CONFIRM_MS = 3000;

type RoundStartPayload = { word: string };
type ResultPayload = { score: number; comment: string; rank: number; points: number };
type PredictPayload = { phase: "predict"; candidates: { id: string; name: string }[] };
type Payload = RoundStartPayload | ResultPayload | PredictPayload;

export class DrawOffController implements ControllerGameModule {
  id = "draw-off" as const;

  private ctx: ControllerGameContext | null = null;
  private drawCapture: DrawCapture | null = null;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderWaiting();
  }

  private renderWaiting(): void {
    this.drawCapture?.destroy();
    this.drawCapture = null;
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Get ready…"]),
        el("p", { class: "text-body" }, ["Everyone draws the same word at once."]),
      ]),
    );
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    const payload = msg.payload as Payload;
    if ("word" in payload) this.renderCanvas(payload.word);
    else if ("phase" in payload && payload.phase === "predict") this.renderPredict(payload);
    else this.renderResult(payload as ResultPayload);
  }

  private renderPredict(payload: PredictPayload): void {
    const ctx = this.ctx!;
    this.drawCapture?.destroy();
    this.drawCapture = null;
    let predicted = false;
    const others = payload.candidates.filter((c) => c.id !== ctx.playerId);
    const cards = others.map((c) => {
      const card = el("div", { class: "glass-card game-card anim-pop-in", style: "align-items:center;justify-content:center" }, [
        el("span", { class: "text-body" }, [c.name]),
      ]);
      card.addEventListener("click", () => {
        if (predicted) return;
        predicted = true;
        vibrate(15);
        ctx.sendInput({ type: "input:prediction", targetPlayerId: c.id, ts: Date.now() });
        renderAnsweredCard(ctx.root, { icon: "🔮", label: "Prediction locked in", sub: "+5 if you're right!" });
      });
      return card;
    });
    ctx.root.replaceChildren(
      el("div", { style: "width:100%" }, [
        el("div", { class: "screen-header" }, [el("h2", { class: "title-md" }, ["Who'll score highest?"])]),
        el("div", { class: "vote-grid" }, cards),
      ]),
    );
  }

  private renderCanvas(word: string): void {
    const ctx = this.ctx!;
    const canvas = el("canvas", { style: "width:100%;height:100%;display:block" }) as HTMLCanvasElement;
    const wrap = el("div", { class: "doodle-canvas-wrap" }, [canvas]);
    const undoBtn = el("button", { class: "glass-button draw-toolbar-btn" }, ["↩ Undo"]) as HTMLButtonElement;
    const clearBtn = el("button", { class: "glass-button draw-toolbar-btn" }, ["🗑 Clear"]);
    undoBtn.disabled = true;
    const doneBtn = el("button", { class: "glass-button accent" }, ["Done ✓"]);

    let strokeColor = ctx.color;
    let strokeWidth = DEFAULT_LINE_WIDTH;
    const toolbar = mountDrawToolbar({
      initialColor: strokeColor,
      onColorChange: (color) => {
        strokeColor = color;
        this.drawCapture?.setColor(color);
      },
      onSizeChange: (width) => {
        strokeWidth = width;
        this.drawCapture?.setLineWidth(width);
      },
    });

    // Plain opacity fade, not anim-pop-in's scale/translate transform: DrawCapture caches
    // getBoundingClientRect() at the start of each stroke, so an ancestor still mid-transform
    // when the player's first touch lands would bake that transient, wrong box into every
    // point of that stroke — this is what caused strokes to render offset from the touch.
    ctx.root.replaceChildren(
      el("div", { class: "draw-screen anim-fade-in" }, [
        el("div", { class: "glass-panel draw-screen-header" }, [
          el("p", { class: "text-caption" }, ["Draw this:"]),
          el("h2", { class: "title-lg" }, [word]),
        ]),
        wrap,
        toolbar,
        el("div", { class: "draw-toolbar" }, [undoBtn, clearBtn]),
        doneBtn,
      ]),
    );

    // canvas.style.width/height (set above) keeps the element's CSS layout size fixed to
    // its container regardless of its drawing-buffer width/height attributes below —
    // without that, an unstyled canvas's rendered size follows its own width/height
    // attributes and this resize loop compounds itself on every ResizeObserver tick.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const c2 = canvas.getContext("2d")!;
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      c2.strokeStyle = strokeColor;
      c2.lineWidth = strokeWidth;
      c2.lineCap = "round";
      c2.lineJoin = "round";
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);

    const localCanvas = new LocalStrokeCanvas(canvas);
    let strokeCount = 0;
    this.drawCapture = new DrawCapture(strokeColor, strokeWidth, (flush) => {
      ctx.sendInput({ type: "input:draw", ...flush });
      localCanvas.addFlush(flush);
      if (flush.phase === "start") {
        strokeCount++;
        undoBtn.disabled = false;
      }
    });
    this.drawCapture.attach(canvas);

    let clearConfirmTimer = 0;
    undoBtn.addEventListener("click", () => {
      if (undoBtn.disabled) return;
      vibrate(10);
      localCanvas.undo();
      strokeCount = Math.max(0, strokeCount - 1);
      undoBtn.disabled = strokeCount === 0;
      ctx.sendInput({ type: "input:draw", points: [], color: strokeColor, strokeId: 0, phase: "undo", ts: Date.now() });
    });
    clearBtn.addEventListener("click", () => {
      if (strokeCount === 0) return;
      if (!clearBtn.classList.contains("confirm-pending")) {
        clearBtn.classList.add("confirm-pending");
        clearBtn.textContent = "Tap again to clear";
        clearConfirmTimer = window.setTimeout(() => {
          clearBtn.classList.remove("confirm-pending");
          clearBtn.textContent = "🗑 Clear";
        }, CLEAR_CONFIRM_MS);
        return;
      }
      clearTimeout(clearConfirmTimer);
      clearBtn.classList.remove("confirm-pending");
      clearBtn.textContent = "🗑 Clear";
      vibrate(10);
      localCanvas.clear();
      strokeCount = 0;
      undoBtn.disabled = true;
      ctx.sendInput({ type: "input:draw", points: [], color: strokeColor, strokeId: 0, phase: "clear", ts: Date.now() });
    });
    doneBtn.addEventListener("click", () => {
      // The round still ends on the server's own timer regardless — this just gives a
      // player who finishes early a real "I'm done" moment instead of an indefinitely
      // frozen canvas. this.drawCapture stays attached (undo/clear/onServerMessage's next
      // payload can still safely destroy it), just visually replaced.
      vibrate(15);
      resizeObserver.disconnect();
      renderAnsweredCard(ctx.root, { icon: "🎨", label: "Submitted!", sub: "Waiting for everyone else to finish…" });
    });
  }

  private renderResult(result: ResultPayload): void {
    this.drawCapture?.destroy();
    this.drawCapture = null;
    vibrate(result.rank === 1 ? [30, 60, 30] : 15);
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, [result.rank === 1 ? "🏆 You won!" : `#${result.rank} place`]),
        el("p", { class: "title-lg" }, [`${result.score}/100`]),
        el("p", { class: "text-body" }, [result.comment]),
        el("p", { class: "text-caption" }, [`+${result.points} points`]),
      ]),
    );
  }

  destroy(): void {
    this.drawCapture?.destroy();
    this.drawCapture = null;
  }
}
