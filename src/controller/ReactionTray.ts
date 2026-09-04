import { el } from "@shared/dom";
import { vibrate } from "./input/haptics";

const EMOJIS = ["😂", "🔥", "😱", "👏", "💀", "❤️"];

/**
 * Always-visible reaction tray, appended to document.body like the score badge and
 * pause banner (see ControllerRouter) so it persists across every screen swap. Shown
 * from the moment a player is in the waiting room onward — wider than the score badge,
 * which is in_game-only — so sitting-out players can still hype the room.
 */
export class ReactionTray {
  private container: HTMLElement;

  constructor(onReact: (emoji: string) => void) {
    const buttons = EMOJIS.map((emoji) => {
      const btn = el("button", { class: "reaction-tray-btn" }, [emoji]);
      btn.addEventListener("click", () => {
        vibrate(10);
        onReact(emoji);
      });
      return btn;
    });
    this.container = el("div", { class: "reaction-tray" }, buttons);
    document.body.append(this.container);
  }

  destroy(): void {
    this.container.remove();
  }
}
