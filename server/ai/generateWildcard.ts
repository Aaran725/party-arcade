import { fetchGroq, withGroqKeyRotation, extractJson } from "./groqClient";
import type { WildcardMechanic } from "@shared/protocol/messages";

// Verify at console.groq.com/docs/models if calls start failing — same small fast text
// model as generateScenario.ts.
const GROQ_TEXT_MODEL = "llama-3.1-8b-instant";

export interface WildcardRound {
  mechanic: WildcardMechanic;
  prompt: string;
  choices?: string[]; // "pick-one" only, 2-4 options
}

const VALID_MECHANICS: WildcardMechanic[] = ["vote", "type", "fast-tap", "pick-one", "aim", "number-guess"];

// Only reached if the AI call fails entirely — mirrors generateScenario.ts's fallback contract.
const FALLBACK_WILDCARDS: WildcardRound[] = [
  { mechanic: "type", prompt: "Type the first word that comes to mind when you hear 'chaos'." },
  { mechanic: "pick-one", prompt: "Which superpower would you pick?", choices: ["Invisibility", "Flight", "Mind reading", "Time travel"] },
  { mechanic: "fast-tap", prompt: "Tap as fast as you can the second it starts!" },
  { mechanic: "vote", prompt: "Vote for who's most likely to survive a zombie apocalypse." },
  { mechanic: "aim", prompt: "Turn your body to point your phone at the target heading!" },
  { mechanic: "number-guess", prompt: "Guess the secret number!" },
];

function pickFallback(): WildcardRound {
  return FALLBACK_WILDCARDS[Math.floor(Math.random() * FALLBACK_WILDCARDS.length)];
}

async function requestWildcard(): Promise<WildcardRound | null> {
  return withGroqKeyRotation(async (key) => {
    const res = await fetchGroq("/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_TEXT_MODEL,
        temperature: 1.0,
        messages: [
          {
            role: "user",
            content:
              'Invent one short party-game mini-round. Pick exactly one mechanic from: "vote" (players vote for which of their friends best fits a funny prompt), "type" (players type a one-word or short-phrase answer), "fast-tap" (players just race to tap first), "pick-one" (players pick one of 2-4 fun options you provide, e.g. "which superpower..."), "aim" (players physically turn their body to point their phone at a compass heading shown on screen — write a fun in-world reason to be aiming at something, e.g. "point toward the nearest pizza place" or "aim at where you think north is"), "number-guess" (players guess a secret hidden number — write a fun in-world reason for the number, e.g. "guess how many jellybeans are in the jar" or "guess the mystery number the AI is thinking of", but note the actual number is chosen separately, not by you). Respond with ONLY a JSON object, no other text: {"mechanic": "<one of the six>", "prompt": "<short, family-friendly prompt or question>", "choices": ["<option 1>", "<option 2>", "<option 3 optional>", "<option 4 optional>"]}. Only include "choices" (2 to 4 entries) for "pick-one" — omit that field entirely for the other five mechanics.',
          },
        ],
      }),
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("groq response missing content");
    const parsed = extractJson(content) as { mechanic?: unknown; prompt?: unknown; choices?: unknown };

    if (typeof parsed.mechanic !== "string" || !VALID_MECHANICS.includes(parsed.mechanic as WildcardMechanic)) {
      throw new Error("groq returned an invalid mechanic");
    }
    if (typeof parsed.prompt !== "string" || parsed.prompt.length === 0) throw new Error("groq returned an empty prompt");
    const mechanic = parsed.mechanic as WildcardMechanic;

    if (mechanic === "pick-one") {
      if (
        !Array.isArray(parsed.choices) ||
        parsed.choices.length < 2 ||
        parsed.choices.length > 4 ||
        !parsed.choices.every((c) => typeof c === "string")
      ) {
        throw new Error("groq returned pick-one without 2-4 valid choices");
      }
      return { mechanic, prompt: parsed.prompt, choices: parsed.choices as string[] };
    }
    return { mechanic, prompt: parsed.prompt };
  });
}

/** Never returns null — falls back to a small local wildcard bank if the AI call fails entirely, same resilience contract as generateScenario.ts. */
export async function getWildcard(): Promise<WildcardRound> {
  return (await requestWildcard()) ?? pickFallback();
}
