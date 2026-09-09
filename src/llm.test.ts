import { describe, expect, it } from "vitest";
import { splitThinking } from "./llm.js";

describe("splitThinking", () => {
  it("is a no-op when there are no tags", () => {
    expect(splitThinking("just the answer")).toEqual({
      thinking: "",
      answer: "just the answer",
    });
  });

  it("pulls inline <think> out of the content", () => {
    expect(splitThinking("<think>hmm</think>the answer")).toEqual({
      thinking: "hmm",
      answer: "the answer",
    });
  });

  it("handles reasoning that spans several lines", () => {
    const raw = "<think>first\n\nsecond</think>\n\nthe answer";
    expect(splitThinking(raw)).toEqual({
      thinking: "first\n\nsecond",
      answer: "the answer",
    });
  });

  it("returns an empty answer when the model only produced reasoning", () => {
    expect(splitThinking("<think>ran out of budget</think>")).toEqual({
      thinking: "ran out of budget",
      answer: "",
    });
  });
});
