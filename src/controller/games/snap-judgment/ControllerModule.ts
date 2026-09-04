import { el } from "@shared/dom";
import type { ControllerGameContext, ControllerGameModule } from "@shared/types/game";
import type { ServerToClientMessage } from "@shared/protocol/messages";
import { renderEnableCameraScreen } from "../../screens/EnableCameraScreen";
import { requestCameraStream, capturePhoto, stopStream } from "../../input/camera-capture";
import { vibrate } from "../../input/haptics";
import { renderAnsweredCard } from "../../components/answeredCard";

type RoundStartPayload = { prompt: string };
type VotePayload = { phase: "vote"; photos: { id: string; name: string; imageData: string }[] };
type Payload = RoundStartPayload | VotePayload;

export class SnapJudgmentController implements ControllerGameModule {
  id = "snap-judgment" as const;

  private ctx: ControllerGameContext | null = null;
  private stream: MediaStream | null = null;
  private permissionGranted = false;
  private captured = false;
  // Bumped every time a new prompt or the round's vote message arrives, and captured
  // locally when renderCapture() starts its async camera acquisition — if a newer message
  // (this round's own "vote" message included) lands before that await resolves, the
  // token comparison below lets renderCapture() notice it's stale and bail instead of
  // clobbering whatever screen is now actually current with a dead capture UI.
  private captureToken = 0;

  init(ctx: ControllerGameContext): void {
    this.ctx = ctx;
    renderEnableCameraScreen(ctx.root, {
      gameTitle: "Snap Judgment",
      onGranted: () => {
        this.permissionGranted = true;
        this.renderWaiting();
      },
    });
  }

  private renderWaiting(): void {
    this.stopStream();
    this.ctx!.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
        el("h2", { class: "title-md" }, ["Get ready…"]),
        el("p", { class: "text-body" }, ["Waiting for the next prompt."]),
      ]),
    );
  }

  private stopStream(): void {
    stopStream(this.stream);
    this.stream = null;
  }

  onServerMessage(msg: ServerToClientMessage): void {
    if (msg.type !== "game:private_message") return;
    if (!this.permissionGranted) return; // a round message arriving before permission is granted — wait for the enable screen's callback instead
    const payload = msg.payload as Payload;
    if ("prompt" in payload) {
      const token = ++this.captureToken;
      void this.renderCapture(payload.prompt, token);
    } else if (payload.phase === "vote") {
      this.captureToken++; // invalidates any capture still in flight for this round
      this.renderVote(payload);
    }
  }

  private async renderCapture(prompt: string, token: number): Promise<void> {
    const ctx = this.ctx!;
    this.captured = false;
    this.stopStream();
    const stream = await requestCameraStream();
    if (token !== this.captureToken) {
      // A newer message arrived while we were waiting on the camera — this capture
      // screen is stale. Release the stream we just acquired rather than leaving it
      // running unused, and don't touch whatever screen is actually current now.
      stopStream(stream);
      return;
    }
    this.stream = stream;
    if (!this.stream) {
      ctx.root.replaceChildren(
        el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
          el("p", { class: "text-body" }, ["Camera unavailable this round — sit tight for the next one."]),
        ]),
      );
      return;
    }

    const video = el("video", { autoplay: true, playsinline: true, muted: true, style: "width:100%;height:100%;object-fit:cover;display:block;transform:scaleX(-1)" }) as HTMLVideoElement;
    video.srcObject = this.stream;
    const captureBtn = el("button", { class: "glass-button accent" }, ["📸 Capture!"]);

    captureBtn.addEventListener("click", () => {
      if (this.captured) return;
      this.captured = true;
      const imageData = capturePhoto(video);
      ctx.sendInput({ type: "input:photo", imageData, ts: Date.now() });
      vibrate(20);
      this.stopStream();
      renderAnsweredCard(ctx.root, { icon: "📸", label: "Captured!", sub: "Waiting for everyone else…" });
    });

    ctx.root.replaceChildren(
      el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center;gap:0.8em" }, [
        el("p", { class: "text-caption" }, ["Prompt"]),
        el("h2", { class: "title-md" }, [prompt]),
        el("div", { class: "doodle-canvas-wrap" }, [video]),
        captureBtn,
      ]),
    );
  }

  private renderVote(payload: VotePayload): void {
    const ctx = this.ctx!;
    this.stopStream();
    const others = payload.photos.filter((p) => p.id !== ctx.playerId);
    let voted = false;

    const cards = others.map((p) => {
      const card = el("div", { class: "glass-card game-card anim-pop-in", style: "padding:0.6em;gap:0.4em" }, [
        el("img", { src: p.imageData, style: "width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;display:block" }),
        el("span", { class: "text-body" }, [p.name]),
      ]);
      card.addEventListener("click", () => {
        if (voted) return;
        voted = true;
        vibrate(15);
        ctx.sendInput({ type: "input:button", buttonId: p.id, pressed: true, ts: Date.now() });
        renderAnsweredCard(ctx.root, { icon: "🗳️", label: "Vote submitted", sub: "Waiting for the results…" });
      });
      return card;
    });

    ctx.root.replaceChildren(
      el("div", { style: "width:100%" }, [
        el("div", { class: "screen-header" }, [el("h2", { class: "title-md" }, ["Vote for your favorite"])]),
        el("div", { class: "vote-grid" }, cards),
      ]),
    );
  }

  destroy(): void {
    this.stopStream();
  }
}
