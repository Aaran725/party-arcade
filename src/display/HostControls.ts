import { el } from "@shared/dom";
import type { PlayerInfo } from "@shared/types/room";
import { createAvatarSvg } from "@shared/avatar";

/**
 * A persistent host-controls affordance, appended directly to document.body so it
 * survives every screen's root.replaceChildren() call — a gear icon that expands into
 * kick/pause/end-round controls. Unobtrusive by default: this is a TV a room full of
 * people is looking at, not a dashboard.
 */
export class HostControls {
  private container: HTMLElement;
  private toggleBtn: HTMLElement;
  private panel: HTMLElement | null = null;
  private players: PlayerInfo[] = [];
  private inGame = false;
  private paused = false;
  private inParty = false;
  private volume = 0.5;
  private muted = false;
  private roomCode = "";

  constructor(
    private onKick: (playerId: string) => void,
    private onPause: () => void,
    private onResume: () => void,
    private onEndRound: () => void,
    private onEndParty: () => void,
    private onVolumeChange: (volume: number) => void,
    private onMuteToggle: () => void,
    private onShowQr: () => void,
    private onTriggerWave: () => void,
  ) {
    this.container = el("div", { style: "position:fixed;top:1em;right:1em;z-index:30;display:flex;flex-direction:column;align-items:flex-end;gap:0.6em" });
    document.body.append(this.container);

    this.toggleBtn = el("button", { class: "glass-button", style: "width:2.6em;height:2.6em;padding:0;border-radius:50%;font-size:1.2em" }, ["⚙"]);
    this.toggleBtn.addEventListener("click", () => this.togglePanel());
    this.container.append(this.toggleBtn);
  }

  update(players: PlayerInfo[], inGame: boolean, paused: boolean, inParty: boolean, roomCode: string): void {
    this.players = players;
    this.inGame = inGame;
    this.paused = paused;
    this.inParty = inParty;
    this.roomCode = roomCode;
    if (this.panel) this.renderPanel();
  }

  /** Called back by Router once a volume/mute change actually lands, so the slider reflects the real state rather than assuming its own input event was applied. */
  updateAudio(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    if (this.panel) this.renderPanel();
  }

  private togglePanel(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      return;
    }
    this.renderPanel();
  }

  private renderPanel(): void {
    this.panel?.remove();

    const rows = this.players.map((p) => {
      const kickBtn = el("button", { class: "glass-button", style: "padding:0.25em 0.7em;font-size:0.78em" }, ["Kick"]);
      kickBtn.addEventListener("click", () => this.onKick(p.id));
      return el("div", { class: "glass-pill", style: "display:flex;align-items:center;gap:0.6em;justify-content:space-between;width:100%" }, [
        el("span", { style: "display:flex;align-items:center;gap:0.5em" }, [
          createAvatarSvg(p.id, p.color),
          p.name,
        ]),
        kickBtn,
      ]);
    });

    const volumeSlider = el("input", {
      type: "range",
      min: "0",
      max: "1",
      step: "0.05",
      value: String(this.volume),
      class: "host-volume-slider",
      disabled: this.muted,
    }) as HTMLInputElement;
    volumeSlider.addEventListener("input", () => this.onVolumeChange(volumeSlider.valueAsNumber));
    const muteBtn = el("button", { class: "glass-button", style: "padding:0.4em 0.8em;font-size:0.85em" }, [this.muted ? "🔇" : "🔊"]);
    muteBtn.addEventListener("click", () => this.onMuteToggle());
    // A fused-capsule pair — two lobes sharing one glass shell with a pinched neck between
    // them, the WWDC25 keyart's dumbbell motif applied to the one real, contained spot in
    // this app it's worth the geometry: the two most-used host actions, always shown
    // together. See .host-controls-cluster in glass.css.
    const qrBtn = el("button", { class: "host-cluster-btn" }, ["Show QR code"]);
    qrBtn.addEventListener("click", () => this.onShowQr());
    const waveBtn = el("button", { class: "host-cluster-btn" }, ["🌊 Phone wave"]);
    waveBtn.addEventListener("click", () => this.onTriggerWave());
    const controlCluster = el("div", { class: "host-controls-cluster" }, [qrBtn, waveBtn]);

    // Distinct from the player-join QR — this link is for someone who isn't physically in
    // the room (a friend on a call, a parent, someone running late) to watch along without
    // taking a player slot. A copyable link makes more sense here than a QR code, since the
    // whole point is they aren't looking at this screen to scan anything off it.
    const watchBtn = el("button", { class: "glass-button" }, ["🔗 Copy watch-along link"]);
    watchBtn.addEventListener("click", () => {
      const url = `${location.origin}/spectate.html?room=${this.roomCode}`;
      if (navigator.share) {
        navigator.share({ title: "Party Arcade", url }).catch(() => {});
        return;
      }
      void navigator.clipboard?.writeText(url).then(() => {
        watchBtn.textContent = "Copied!";
        setTimeout(() => (watchBtn.textContent = "🔗 Copy watch-along link"), 1800);
      });
    });

    const audioRow = el("div", { style: "display:flex;align-items:center;gap:0.6em;width:100%" }, [muteBtn, volumeSlider]);

    const gameControls: HTMLElement[] = [];
    if (this.inGame) {
      const pauseBtn = el("button", { class: "glass-button accent" }, [this.paused ? "Resume" : "Pause"]);
      pauseBtn.addEventListener("click", () => (this.paused ? this.onResume() : this.onPause()));
      const endBtn = el("button", { class: "glass-button" }, ["End round"]);
      endBtn.addEventListener("click", () => this.onEndRound());
      gameControls.push(pauseBtn, endBtn);
    }
    if (this.inParty && !this.inGame) {
      const endPartyBtn = el("button", { class: "glass-button" }, ["End party"]);
      endPartyBtn.addEventListener("click", () => this.onEndParty());
      gameControls.push(endPartyBtn);
    }

    this.panel = el(
      "div",
      { class: "glass-panel anim-pop-in", style: "padding:1em;display:flex;flex-direction:column;gap:0.6em;min-width:240px;max-height:60vh;overflow-y:auto" },
      [
        el("p", { class: "text-caption" }, ["Host controls"]),
        audioRow,
        controlCluster,
        watchBtn,
        ...gameControls,
        ...(this.players.length ? rows : [el("p", { class: "text-body" }, ["No players yet."])]),
      ],
    );
    this.container.append(this.panel);
  }

  destroy(): void {
    this.container.remove();
  }
}
