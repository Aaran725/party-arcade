import { ALL_GAME_IDS, type GameId } from "./types/room";

// Derived, never hand-maintained. This was a manual constant on the theory that the count
// was only knowable from server/games/registry.ts, which this file can't import — but the
// roster is already enumerated in shared types, so it was always derivable. The constant
// had drifted to 16 against a 17-game roster, unlocking "Well-Rounded" a game early.
const TOTAL_GAME_COUNT = ALL_GAME_IDS.length;

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
