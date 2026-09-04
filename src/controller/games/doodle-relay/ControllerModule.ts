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

type RoundStartPayload = { role: "artist"; word: string } | { role: "guesser" };
type ArbitratePayload = { phase: "arbitrate"; guesserName: string };
type ResumePayload = { phase: "resume" };
type Payload = RoundStartPayload | ArbitratePayload | ResumePayload;

export class DoodleRelayController implements ControllerGameModule {
  id = "doodle-relay" as const;

  private ctx: ControllerGameContext | null = null;
  private drawCapture: DrawCapture | null = null;
  private buzzed = false;
  // A fixed overlay on document.body, not a ctx.root.replaceChildren() — the Artist's
  // in-progress canvas, undo history, and toolbar live underneath and must survive a
  // buzz-in/arbitration cycle untouched (previously replaceChildren() destroyed and
  // later fully rebuilt them from scratch, which read as the whole screen "restarting"
  // every time someone buzzed in, even on a wrong guess that keeps the same round going).
  private arbitrateOverlay: HTMLElement | null = null;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    this.renderWaiting();
  }

  private renderWaiting(): void {
    this.drawCapture?.destroy();
    this.drawCapture = null;
    this.dismissArbitrateOverlay();
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
    if ("role" in payload) {
      this.dismissArbitrateOverlay();
      if (payload.role === "artist") this.renderArtist(payload.word);
      else this.renderGuesser();
    } else if (payload.phase === "arbitrate") {
      this.renderArbitrate(payload.guesserName);
    } else if (payload.phase === "resume") {
      // A wrong guess — the round continues with the same word and the same canvas,
      // so there's nothing to rebuild, just the overlay to take down.
      this.dismissArbitrateOverlay();
    }
  }

  private dismissArbitrateOverlay(): void {
    this.arbitrateOverlay?.remove();
    this.arbitrateOverlay = null;
  }

  private renderArtist(word: string): void {
    const ctx = this.ctx!;
    this.buzzed = false;
    const canvas = el("canvas", { style: "width:100%;height:100%;display:block" }) as HTMLCanvasElement;
    const wrap = el("div", { class: "doodle-canvas-wrap" }, [canvas]);
    const undoBtn = el("button", { class: "glass-button draw-toolbar-btn" }, ["↩ Undo"]) as HTMLButtonElement;
    const clearBtn = el("button", { class: "glass-button draw-toolbar-btn" }, ["🗑 Clear"]);
    undoBtn.disabled = true;

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
      ]),
    );

    // canvas.style.width/height (set above) keeps the element's CSS layout size fixed to
    // its container regardless of its drawing-buffer width/height attributes below —
    // without that, an unstyled canvas's rendered size follows its own width/height
    // attributes, and this resize loop would compound itself on every ResizeObserver tick.
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
    new ResizeObserver(resize).observe(wrap);

    // Local preview stroke so the Artist sees their own line while drawing, in addition
    // to relaying points to the display — the display is the source of truth, this is
    // just immediate visual feedback on the phone itself.
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
  }

  private renderGuesser(): void {
    this.buzzed = false;
    this.drawCapture?.destroy();
    this.drawCapture = null;
    const ctx = this.ctx!;
    const btn = el("button", { class: "glass-button accent", style: "width:100%;padding:2em;font-size:1.4rem" }, ["I know it! 🙋"]);
    btn.addEventListener("click", () => {
      if (this.buzzed) return;
      this.buzzed = true;
      vibrate(20);
      ctx.sendInput({ type: "input:button", buttonId: "buzz", pressed: true, ts: Date.now() });
      renderAnsweredCard(ctx.root, { icon: "🙋", label: "Buzzed in!", sub: "Waiting for confirmation…" });
    });
    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("p", { class: "text-body" }, [
          "Watch the big screen. Shout your guess out loud, then buzz in if you're right — the faster you buzz, the more points you score.",
        ]),
        btn,
      ]),
    );
  }

  private renderArbitrate(guesserName: string): void {
    this.dismissArbitrateOverlay();
    const ctx = this.ctx!;
    const correctBtn = el("button", { class: "glass-button accent" }, ["Correct ✓"]);
    const wrongBtn = el("button", { class: "glass-button" }, ["Wrong ✗"]);
    correctBtn.addEventListener("click", () => {
      vibrate(20);
      ctx.sendInput({ type: "input:button", buttonId: "correct", pressed: true, ts: Date.now() });
      // Optimistic dismiss — the round is ending either way (a whole new round message
      // will replace this screen shortly), no need to wait on a round trip.
      this.dismissArbitrateOverlay();
    });
    wrongBtn.addEventListener("click", () => {
      vibrate(10);
      ctx.sendInput({ type: "input:button", buttonId: "wrong", pressed: true, ts: Date.now() });
      this.dismissArbitrateOverlay();
    });
    // A fixed overlay, not ctx.root.replaceChildren() — the Artist's canvas and toolbar
    // stay mounted underneath the whole time, so nothing about their in-progress drawing
    // is lost while they judge the guess.
    this.arbitrateOverlay = el(
      "div",
      { style: "position:fixed;inset:0;z-index:35;display:flex;align-items:center;justify-content:center;padding:1.4em;background:rgba(0,0,0,0.55)" },
      [
        el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
          el("h2", { class: "title-md" }, [`${guesserName} buzzed in`]),
          el("p", { class: "text-body" }, ["Did they say the right word?"]),
          correctBtn,
          wrongBtn,
        ]),
      ],
    );
    document.body.append(this.arbitrateOverlay);
  }

  destroy(): void {
    this.drawCapture?.destroy();
    this.drawCapture = null;
    this.dismissArbitrateOverlay();
  }
}
