import type { PlayerInfo } from "./types/room";

// Standings-check-in commentary — a small template bank, same "data file, not logic"
// placement as trivia-bank.ts, filled in with player names/gap at call time.

export type StandingsSituation = "big-lead" | "close-race" | "comeback" | "tied";

export const STANDINGS_TEMPLATES: Record<StandingsSituation, string[]> = {
  "big-lead": [
    "{leader} is running away with it — {gap} points clear.",
    "{leader} is in a league of their own right now.",
    "Nobody's caught {leader} yet. {gap} points and counting.",
  ],
  "close-race": [
    "{leader} barely holds the lead over {rival} — just {gap} points.",
    "It's anyone's game: {leader} and {rival} are neck and neck.",
    "{gap} points separate {leader} and {rival}. Anything can happen.",
  ],
  comeback: [
    "{riser} just closed the gap in a big way.",
    "Watch out for {riser} — climbing fast.",
    "{riser} is making a real move up the standings.",
  ],
  tied: ["{leader} and {rival} are tied at the top!", "Dead heat between {leader} and {rival}."],
};

const OPENERS = ["Let the party begin!", "Everyone starts even — good luck!", "First round, anyone's game."];

export interface StandingsBlurbInput {
  standings: Record<string, number>;
  players: PlayerInfo[];
  previousStandings?: Record<string, number>;
}

function nameFor(players: PlayerInfo[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? "Someone";
}

export function pickStandingsBlurb(input: StandingsBlurbInput): string {
  const { standings, players, previousStandings } = input;
  const ranked = Object.entries(standings).sort((a, b) => b[1] - a[1]);
  const maxScore = ranked[0]?.[1] ?? 0;

  if (ranked.length === 0 || maxScore === 0) {
    return OPENERS[Math.floor(Math.random() * OPENERS.length)];
  }

  const [leaderId, leaderScore] = ranked[0];
  const [rivalId, rivalScore] = ranked[1] ?? [leaderId, leaderScore];
  const gap = leaderScore - rivalScore;
  const total = Math.max(1, leaderScore);

  let riserId = leaderId;
  let biggestDelta = -Infinity;
  if (previousStandings) {
    for (const [id, score] of Object.entries(standings)) {
      const delta = score - (previousStandings[id] ?? 0);
      if (delta > biggestDelta) {
        biggestDelta = delta;
        riserId = id;
      }
    }
  }

  let situation: StandingsSituation;
  if (previousStandings && riserId !== leaderId && biggestDelta > 0 && gap <= Math.max(3, total * 0.15)) {
    situation = "comeback";
  } else if (gap === 0) {
    situation = "tied";
  } else if (gap > total * 0.35) {
    situation = "big-lead";
  } else {
    situation = "close-race";
  }

  const templates = STANDINGS_TEMPLATES[situation];
  const template = templates[Math.floor(Math.random() * templates.length)];

  return template
    .replace("{leader}", nameFor(players, leaderId))
    .replace("{rival}", nameFor(players, rivalId))
    .replace("{riser}", nameFor(players, riserId))
    .replace("{gap}", String(gap));
}
