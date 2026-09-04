import { fetchGroq, withGroqKeyRotation, extractJson } from "./groqClient";
import type { WildcardMechanic } from "@shared/protocol/messages";

// Verify at console.groq.com/docs/models if calls start failing — same small fast text
// model as generateScenario.ts.
const GROQ_TEXT_MODEL = "llama-3.1-8b-instant";

export interface WildcardRound {
  mechanic: WildcardMechanic;
  prompt: string;
  choices?: [string, string];
}

const VALID_MECHANICS: WildcardMechanic[] = ["vote", "type", "fast-tap", "would-you-rather", "aim"];

// Only reached if the AI call fails entirely — mirrors generateScenario.ts's fallback contract.
const FALLBACK_WILDCARDS: WildcardRound[] = [
  { mechanic: "type", prompt: "Type the first word that comes to mind when you hear 'chaos'." },
  { mechanic: "would-you-rather", prompt: "Would you rather...", choices: ["Fight one horse-sized duck", "Fight 100 duck-sized horses"] },
  { mechanic: "fast-tap", prompt: "Tap as fast as you can the second it starts!" },
  { mechanic: "vote", prompt: "Vote for who's most likely to survive a zombie apocalypse." },
  { mechanic: "aim", prompt: "Turn your body to point your phone at the target heading!" },
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
              'Invent one short party-game mini-round. Pick exactly one mechanic from: "vote" (players vote for which of their friends best fits a funny prompt), "type" (players type a one-word or short-phrase answer), "fast-tap" (players just race to tap first), "would-you-rather" (a two-option dilemma), "aim" (players physically turn their body to point their phone at a compass heading shown on screen — write a fun in-world reason to be aiming at something, e.g. "point toward the nearest pizza place" or "aim at where you think north is"). Respond with ONLY a JSON object, no other text: {"mechanic": "<one of the five>", "prompt": "<short, family-friendly prompt or question>", "choices": ["<option A>", "<option B>"]}. Only include "choices" for "would-you-rather" — omit that field entirely for the other four mechanics.',
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

    if (mechanic === "would-you-rather") {
      if (!Array.isArray(parsed.choices) || parsed.choices.length !== 2 || !parsed.choices.every((c) => typeof c === "string")) {
        throw new Error("groq returned would-you-rather without two valid choices");
      }
      return { mechanic, prompt: parsed.prompt, choices: parsed.choices as [string, string] };
    }
    return { mechanic, prompt: parsed.prompt };
  });
}

/** Never returns null — falls back to a small local wildcard bank if the AI call fails entirely, same resilience contract as generateScenario.ts. */
export async function getWildcard(): Promise<WildcardRound> {
  return (await requestWildcard()) ?? pickFallback();
}
