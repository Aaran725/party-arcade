import { fetchGroq, withGroqKeyRotation } from "./groqClient";

// Verify at console.groq.com/docs/models if calls start failing — a small fast Groq text
// model, not the vision one rateDrawing.ts uses.
const GROQ_TEXT_MODEL = "llama-3.1-8b-instant";

const FALLBACK_SCENARIOS = [
  "You just discovered your houseplant has been secretly texting your ex. What do you do?",
  "The office vending machine only dispenses live goldfish today. How do you explain this to your boss?",
  "Your GPS insists the fastest route home is through the ocean. Do you trust it?",
  "You wake up and everyone around you is speaking only in movie quotes. What's your first line?",
  "A raccoon in a tiny business suit hands you its resume. Do you hire it?",
  "Your reflection waves at you first. What do you say back?",
];

function pickFallback(): string {
  return FALLBACK_SCENARIOS[Math.floor(Math.random() * FALLBACK_SCENARIOS.length)];
}

async function requestScenario(): Promise<string | null> {
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
              "Write one short, absurd, family-friendly scenario for a party game. Exactly two sentences, ending in a question, under 30 words total. Respond with ONLY the scenario text, no quotes or preamble.",
          },
        ],
      }),
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("groq response missing content");
    const cleaned = content.trim().replace(/^["']|["']$/g, "");
    if (cleaned.length === 0) throw new Error("groq returned an empty scenario");
    return cleaned;
  });
}

/** Never returns null — falls back to a small local scenario bank if the AI call fails entirely, so a round never hangs on a bad API moment. */
export async function getScenario(): Promise<string> {
  return (await requestScenario()) ?? pickFallback();
}
