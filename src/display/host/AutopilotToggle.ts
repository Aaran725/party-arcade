import { el } from "@shared/dom";

/**
 * Persistent "🚀 Autopilot" pill next to the Game Leader toggle (GameLeaderToggle.ts) —
 * same pattern, appended directly to document.body so it survives every screen's
 * root.replaceChildren() call. Governs whether Router.ts's advanceParty() picks the next
 * game itself (src/display/party/autopilot.ts) instead of stepping through the pre-shuffled
 * queue — a pure opt-in, off by default, exactly like the Leader toggle it sits beside.
 */
export class AutopilotToggle {
  private container: HTMLElement;
  private btn: HTMLElement;
  private enabled = false;

  constructor(private onToggle: (enabled: boolean) => void) {
    this.btn = el("button", { class: "glass-button", style: "font-size:0.85em;padding:0.5em 0.9em" }, ["🚀 Autopilot: Off"]);
    this.btn.addEventListener("click", () => {
      this.enabled = !this.enabled;
      this.render();
      this.onToggle(this.enabled);
    });
    this.container = el("div", { style: "position:fixed;top:1em;right:15em;z-index:30" }, [this.btn]);
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
    this.btn.textContent = this.enabled ? "🚀 Autopilot: On" : "🚀 Autopilot: Off";
    this.btn.classList.toggle("accent", this.enabled);
  }

  destroy(): void {
    this.container.remove();
  }
}
