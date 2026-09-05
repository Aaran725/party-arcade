import type { WildcardMechanic } from "@shared/protocol/messages";
import type { ControllerMechanicRenderer } from "./types";
import { renderVote } from "./vote";
import { renderType } from "./type";
import { renderFastTap } from "./fastTap";
import { renderAim } from "./aim";
import { renderPickOne } from "./pickOne";
import { renderNumberGuess } from "./numberGuess";

export type { ControllerMechanicContext, ControllerMechanicRenderer, WildcardPayload } from "./types";

export const WILDCARD_CONTROLLER_MECHANICS: Record<WildcardMechanic, ControllerMechanicRenderer> = {
  vote: renderVote,
  type: renderType,
  "fast-tap": renderFastTap,
  aim: renderAim,
  "pick-one": renderPickOne,
  "number-guess": renderNumberGuess,
};
