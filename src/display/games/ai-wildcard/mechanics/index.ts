import type { WildcardMechanic } from "@shared/protocol/messages";
import type { DisplayMechanicHandler } from "./types";
import { createVoteMechanic } from "./vote";
import { createTypeMechanic } from "./type";
import { createFastTapMechanic } from "./fastTap";
import { createAimMechanic } from "./aim";
import { createPickOneMechanic } from "./pickOne";
import { createNumberGuessMechanic } from "./numberGuess";

export type { DisplayMechanicHandler, RankedResult, WildcardRoundData } from "./types";

// One singleton handler per mechanic — each holds its own per-round state internally and
// clears it via reset(), so DisplayModule.ts never needs to know a mechanic's internals,
// only this lookup.
export const WILDCARD_MECHANICS: Record<WildcardMechanic, DisplayMechanicHandler> = {
  vote: createVoteMechanic(),
  type: createTypeMechanic(),
  "fast-tap": createFastTapMechanic(),
  aim: createAimMechanic(),
  "pick-one": createPickOneMechanic(),
  "number-guess": createNumberGuessMechanic(),
};
