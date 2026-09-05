import type { ControllerGameContext } from "@shared/types/game";
import type { InputMessage, WildcardMechanic } from "@shared/protocol/messages";

export type WildcardPayload = {
  mechanic: WildcardMechanic;
  prompt: string;
  choices?: string[];
  candidates: { id: string; name: string }[];
  targetHeading?: number; // aim only — never sent for number-guess
};

export interface ControllerMechanicContext {
  ctx: ControllerGameContext;
  payload: WildcardPayload;
  /** Every mechanic ends the same way: guard against double-submit, a short haptic buzz, send the input, then show the "locked in" card. Centralizing it here means each mechanic file only ever calls this once, instead of repeating the guard+vibrate+render sequence. */
  submit(vibrateMs: number, msg: InputMessage): void;
}

/** Renders one mechanic's UI into `mc.ctx.root`. Returns an optional cleanup function (aim's compass subscription is the only one that needs it) — the orchestrator calls it before rendering the next round. */
export type ControllerMechanicRenderer = (mc: ControllerMechanicContext) => (() => void) | void;
