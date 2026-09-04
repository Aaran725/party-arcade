import { extractJson, fetchGroq, withGroqKeyRotation } from "./groqClient";

// Verify at console.groq.com/docs/vision if calls start failing — Groq's hosted vision
// lineup shifts over time and this ID may need updating; a wrong/retired model just makes
// every rating fail gracefully into the local heuristic fallback, never a crash.
const GROQ_VISION_MODEL = "qwen/qwen3.6-27b";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface DrawingRating {
  score: number;
  comment: string;
}

/**
 * Rates a single drawing against the prompt word via Groq's vision-capable chat
 * completions API. Returns null if every key fails, so the caller can fall back to a
 * local heuristic score instead of hanging or breaking a live round.
 */
export async function rateDrawing(imageDataUrl: string, word: string): Promise<DrawingRating | null> {
  return withGroqKeyRotation(async (key) => {
    const res = await fetchGroq("/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        temperature: 0.4,
        reasoning_effort: "none", // this model thinks by default (<think>...</think> before the answer) — "none" skips straight to a clean JSON reply, faster and avoids needing to strip reasoning text from every response
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `This is a drawing from a party game. The prompt was "${word}". Rate how well it represents the prompt, 0-100, weighing recognizability and effort. Respond with ONLY a JSON object, no other text: {"score": <integer 0-100>, "comment": "<one short punchy sentence about the drawing>"}`,
              },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("groq response missing message content");
    const parsed = extractJson(content) as { score?: unknown; comment?: unknown };
    if (typeof parsed.score !== "number") throw new Error("groq response missing numeric score");

    return {
      score: clamp(Math.round(parsed.score), 0, 100),
      comment: String(parsed.comment ?? "").slice(0, 140),
    };
  });
}
