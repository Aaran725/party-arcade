import type { GameId } from "./types/room";

// Bump this when a new game is added to the registry — "played every game" can't be
// computed from in here (this file has no access to server/games/registry.ts), so it's a
// small manual constant instead, same trade-off as the Groq model-id hedges elsewhere.
const TOTAL_GAME_COUNT = 16;

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  playCounts: Partial<Record<GameId, number>>;
  winsByGame: Partial<Record<GameId, number>>;
}

export interface Achievement {
  id: string;
  emoji: string;
  title: string;
  description: string;
  check: (stats: PlayerStats) => boolean;
}

// Server-only in practice (only server/storage/playerStore.ts calls `check`) but kept
// here, not split into a server file, so the Career screen can render title/description/
// emoji for every achievement — including ones a player hasn't unlocked yet — without a
// second, easy-to-drift copy of the list.
export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-win", emoji: "🥇", title: "First Win", description: "Finish 1st in any game.", check: (s) => s.wins >= 1 },
  { id: "veteran", emoji: "🎮", title: "Veteran", description: "Play 10 games.", check: (s) => s.gamesPlayed >= 10 },
  {
    id: "well-rounded",
    emoji: "🌈",
    title: "Well-Rounded",
    description: "Play every game at least once.",
    check: (s) => Object.keys(s.playCounts).length >= TOTAL_GAME_COUNT,
  },
  {
    id: "champion",
    emoji: "🏆",
    title: "Champion",
    description: "Win a Push Battle tournament.",
    check: (s) => (s.winsByGame["push-battle"] ?? 0) >= 1,
  },
  {
    id: "hat-trick",
    emoji: "🎩",
    title: "Hat Trick",
    description: "Win the same game three times.",
    check: (s) => Object.values(s.winsByGame).some((w) => (w ?? 0) >= 3),
  },
];
