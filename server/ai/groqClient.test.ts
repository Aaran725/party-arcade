import { describe, expect, it } from "vitest";
import { extractJson } from "./groqClient";

// This is the repair layer standing between a chatty model and a live party round — every
// AI feature (wildcards, scenarios, drawing ratings) parses through it, and a throw here
// is what triggers the local fallback banks.
describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"mechanic":"vote"}')).toEqual({ mechanic: "vote" });
  });

  it("strips a markdown code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips a bare fence with no language tag", () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips a <think> block", () => {
    expect(extractJson('<think>weighing the options</think>{"a":1}')).toEqual({ a: 1 });
  });

  it("handles a think block and a fence together", () => {
    expect(extractJson('<think>hmm</think>\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("pulls the object out of surrounding prose", () => {
    expect(extractJson('Sure! Here you go: {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  it("keeps nested objects intact", () => {
    // The extraction regex is greedy specifically so a nested closing brace doesn't
    // truncate the match at the first `}`.
    expect(extractJson('prose {"a":{"b":2}} more')).toEqual({ a: { b: 2 } });
  });

  it("throws on content with no JSON at all, so callers fall back", () => {
    expect(() => extractJson("I'm afraid I can't do that.")).toThrow();
  });

  it("throws on malformed JSON rather than returning something half-parsed", () => {
    expect(() => extractJson('{"a":}')).toThrow();
  });
});
