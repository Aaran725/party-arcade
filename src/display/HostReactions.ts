import { el } from "@shared/dom";
import { playChime, playSweep, playNoiseBurst, playTone } from "@shared/audio";

// One synthesized sound per reaction emoji, played on the Display (the TV's real speakers)
// rather than the sender's phone — Router.ts's "game:reaction" case is the one place every
// reaction already flows through, so this is the single spot that makes the tray read as a
// soundboard for the whole room instead of a private per-phone buzz.
const REACTION_SOUNDS: Record<string, () => void> = {
  "😂": () => playChime([440, 660, 520, 740], { noteDuration: 0.08, gap: 0.02, type: "square", gain: 0.22 }),
  "🔥": () => playSweep({ fromFreq: 220, toFreq: 1400, duration: 0.32, type: "sawtooth", gain: 0.2 }),
  "😱": () => playSweep({ fromFreq: 1200, toFreq: 260, duration: 0.28, type: "sine", gain: 0.24 }),
  "👏": () => {
    for (let i = 0; i < 6; i++) {
      setTimeout(() => playNoiseBurst({ duration: 0.06, gain: 0.22, filterFreq: 2200, filterQ: 0.7 }), i * 70);
    }
  },
  "💀": () => playChime([392, 349.23, 293.66], { noteDuration: 0.22, gap: 0.03, type: "sawtooth", gain: 0.26 }),
  "❤️": () => playChime([523.25, 659.25], { noteDuration: 0.16, gap: 0.04, type: "triangle", gain: 0.22 }),
};
const DEFAULT_REACTION_SOUND = () => playTone({ freq: 700, duration: 0.1, type: "triangle", gain: 0.2 });

/**
 * Floating emoji reactions from any connected player, in any phase — lobby, mid-game,
 * party-next, finale. Appended directly to document.body, like HostControls, so it
 * survives every screen's root.replaceChildren() call. Plain DOM/CSS, not the canvas
 * particle system — particles.ts is tied to a game's own createStageCanvas draw loop
 * and wouldn't render over non-canvas screens like the lobby.
 */
export class HostReactions {
  private container: HTMLElement;

  constructor() {
    this.container = el("div", { style: "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:25" });
    document.body.append(this.container);
  }

  spawn(_playerId: string, emoji: string): void {
    const spawnX = 20 + Math.random() * 60; // 20%-80vw, so simultaneous reactions don't stack
    const span = el("span", { class: "reaction-burst", style: `--spawn-x:${spawnX}vw` }, [emoji]);
    span.addEventListener("animationend", () => span.remove());
    this.container.append(span);
    (REACTION_SOUNDS[emoji] ?? DEFAULT_REACTION_SOUND)();
  }

  destroy(): void {
    this.container.remove();
  }
}
