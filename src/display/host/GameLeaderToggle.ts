import { el } from "@shared/dom";

/**
 * Persistent "🤖 Game Leader" pill next to the settings gear (HostControls.ts) — appended
 * directly to document.body so it survives every screen's root.replaceChildren() call,
 * same pattern as HostControls/HostReactions. Replaces the old one-shot toggle that only
 * lived inside PartySetupScreen: this single switch now governs the Leader everywhere —
 * Quick Play's GameOverScreen included, not just Party Mode transitions.
 */
export class GameLeaderToggle {
  private container: HTMLElement;
  private btn: HTMLElement;
  private enabled = false;

  constructor(private onToggle: (enabled: boolean) => void) {
    this.btn = el("button", { class: "glass-button", style: "font-size:0.85em;padding:0.5em 0.9em" }, ["🤖 Game Leader: Off"]);
    this.btn.addEventListener("click", () => {
      this.enabled = !this.enabled;
      this.render();
      this.onToggle(this.enabled);
    });
    this.container = el("div", { style: "position:fixed;top:1em;right:4.4em;z-index:30" }, [this.btn]);
    document.body.append(this.container);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Forces back to Off without a click — e.g. after a failed mount, or a fresh/resumed room. */
  reset(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.render();
  }

  private render(): void {
    this.btn.textContent = this.enabled ? "🤖 Game Leader: On" : "🤖 Game Leader: Off";
    this.btn.classList.toggle("accent", this.enabled);
  }

  destroy(): void {
    this.container.remove();
  }
}
