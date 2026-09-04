// Spoken-aloud lines for the AI Game Leader — same "data, not logic" placement as
// party-commentary.ts and word-bank.ts. Kept separate from party-commentary.ts because
// these are full sentences addressed to the room by a persona, not short standings blurbs.

const WELCOME_LINES = [
  "Welcome, everyone! I'm your Game Leader tonight — let's get this party started.",
  "Alright, party people — I'm running the show tonight. Let's see what you've got.",
  "Good to have you all here. I'll be your host for tonight's games.",
];

const FINALE_LINES = [
  "And that's a wrap! Congratulations, {winner} — you're tonight's champion!",
  "Game over, everyone. Take a bow, {winner} — you earned it.",
  "That's the party, folks. {winner} takes the win tonight!",
];

// Reaction lines — fired mid-round from inside a DisplayModule's own logic (a combo
// streak, a nail-biter finish, a new record), not just between rounds like the lines
// above. Kept generic enough to fit any game rather than templated per-game.
const COMBO_LINES = [
  "{player} is on fire — that's {streak} in a row!",
  "Nobody can stop {player} right now — {streak} straight!",
  "{streak} in a row for {player}! Somebody slow them down.",
];

const CLOSE_CALL_LINES = [
  "Oh, that was close! Right down to the wire.",
  "That's about as close as it gets, folks.",
  "Nail-biter! I don't think anyone saw that coming.",
];

const RECORD_LINES = [
  "New record! {player} just set the bar.",
  "That's the best we've seen all night, {player}!",
  "{player} just broke the record — take notes, everyone else.",
];

export function pickWelcomeLine(): string {
  return WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)];
}

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), template);
}

export function pickComboLine(playerName: string, streak: number): string {
  const template = COMBO_LINES[Math.floor(Math.random() * COMBO_LINES.length)];
  return fillTemplate(template, { player: playerName, streak });
}

export function pickCloseCallLine(): string {
  return CLOSE_CALL_LINES[Math.floor(Math.random() * CLOSE_CALL_LINES.length)];
}

export function pickRecordLine(playerName: string): string {
  const template = RECORD_LINES[Math.floor(Math.random() * RECORD_LINES.length)];
  return fillTemplate(template, { player: playerName });
}

/** Announces the next game by its real title + description — no AI generation needed, the content already exists in GameMeta. */
export function nextGameLine(title: string, description: string): string {
  return `I'm sending you to ${title}. ${description}`;
}

export function pickFinaleLine(winnerName: string): string {
  const template = FINALE_LINES[Math.floor(Math.random() * FINALE_LINES.length)];
  return template.replace("{winner}", winnerName);
}
