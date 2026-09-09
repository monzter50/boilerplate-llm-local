import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_ID,
  getPrompt,
  hasPrompt,
  listPrompts,
} from "./prompts.js";

describe("the prompt registry", () => {
  it("loads every prompts/*.md file by its basename", () => {
    const ids = listPrompts();
    expect(ids).toContain(DEFAULT_PROMPT_ID);
    expect(ids).toContain("coder");
    expect(ids).toContain("translator");
  });

  it("returns the file contents, trimmed", () => {
    const prompt = getPrompt("translator");
    expect(prompt.startsWith("You are a translator.")).toBe(true);
    expect(prompt).toBe(prompt.trim());
  });

  it("reports which ids exist", () => {
    expect(hasPrompt("coder")).toBe(true);
    expect(hasPrompt("nope")).toBe(false);
  });

  it("names the available ids when one is unknown", () => {
    // The message is what the API returns on a bad promptId, so it has to be
    // actionable rather than just "not found".
    expect(() => getPrompt("nope")).toThrow(/Unknown prompt 'nope'/);
    expect(() => getPrompt("nope")).toThrow(/coder/);
  });
});
