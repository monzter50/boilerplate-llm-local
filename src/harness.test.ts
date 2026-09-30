import { describe, expect, it } from "vitest";
import {
  buildMessages,
  describeModel,
  familyOf,
  resolveParams,
  trimHistory,
} from "./harness.js";
import { getPrompt } from "./prompts.js";
import type { ChatMessage } from "./llm.js";

const user = (content: string): ChatMessage => ({ role: "user", content });
const assistant = (content: string): ChatMessage => ({
  role: "assistant",
  content,
});

describe("familyOf", () => {
  it("treats R1-0528 as a reasoner that accepts a system role", () => {
    expect(familyOf("deepseek/deepseek-r1-0528-qwen3-8b")).toMatchObject({
      supportsSystem: true,
      temperature: 0.6,
    });
  });

  it("treats the original R1 as a reasoner without a system role", () => {
    expect(familyOf("deepseek-r1-distill-qwen-7b")).toMatchObject({
      supportsSystem: false,
      temperature: 0.6,
    });
  });

  it("falls back to a plain chat family", () => {
    expect(familyOf("qwen2.5-7b-instruct")).toMatchObject({
      supportsSystem: true,
      temperature: 0.7,
    });
  });
});

describe("describeModel", () => {
  it("flags reasoning models, so clients can label them", () => {
    expect(describeModel("deepseek/deepseek-r1-0528-qwen3-8b")).toEqual({
      id: "deepseek/deepseek-r1-0528-qwen3-8b",
      family: "reasoner",
      reasoning: true,
      supportsSystem: true,
    });
    expect(describeModel("qwen2.5-7b-instruct")).toMatchObject({
      family: "chat",
      reasoning: false,
    });
  });
});

describe("resolveParams", () => {
  it("lets a per-request override win", () => {
    const params = resolveParams("deepseek-r1-distill-qwen-7b", {
      temperature: 1.5,
      maxTokens: 10,
    });
    expect(params).toEqual({ temperature: 1.5, maxTokens: 10 });
  });

  it("uses the family default when nothing overrides it", () => {
    // TEMPERATURE is unset in the test env, so the family value applies.
    expect(resolveParams("deepseek-r1-distill-qwen-7b").temperature).toBe(0.6);
    expect(resolveParams("qwen2.5-7b-instruct").temperature).toBe(0.7);
  });
});

describe("trimHistory", () => {
  it("keeps everything that fits", () => {
    const turns = [user("a"), assistant("b")];
    expect(trimHistory(turns, 100)).toEqual(turns);
  });

  it("drops the oldest turns first, and only as many as needed", () => {
    const turns = [user("a".repeat(50)), assistant("b".repeat(50)), user("c")];
    // 101 characters against a budget of 60: dropping the first turn is enough.
    expect(trimHistory(turns, 60)).toEqual([turns[1], turns[2]]);
  });

  it("never drops the turn being answered", () => {
    const turns = [user("a".repeat(500)), user("b".repeat(500))];
    const kept = trimHistory(turns, 1);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toEqual(turns[1]);
  });
});

describe("buildMessages", () => {
  const chatModel = "qwen2.5-7b-instruct";
  const legacyReasoner = "deepseek-r1-distill-qwen-7b";

  it("prepends the system prompt for models that accept the role", () => {
    const messages = buildMessages({
      model: chatModel,
      promptId: "translator",
      message: "hola",
    });

    expect(messages[0]).toEqual({
      role: "system",
      content: getPrompt("translator"),
    });
    expect(messages[1]).toEqual(user("hola"));
  });

  it("folds the system prompt into the LAST user turn when there is no system role", () => {
    const messages = buildMessages({
      model: legacyReasoner,
      promptId: "translator",
      messages: [user("primera"), assistant("ok"), user("segunda")],
    });

    expect(messages.every((m) => m.role !== "system")).toBe(true);
    expect(messages[0]).toEqual(user("primera"));
    expect(messages[2]?.content).toBe(`${getPrompt("translator")}\n\nsegunda`);
  });

  it("lets a system turn from the caller win over promptId", () => {
    const messages = buildMessages({
      model: chatModel,
      promptId: "coder",
      messages: [{ role: "system", content: "FROM THE CLIENT" }, user("hola")],
    });

    expect(messages[0]).toEqual({ role: "system", content: "FROM THE CLIENT" });
  });

  it("lets raw system text win over promptId", () => {
    const messages = buildMessages({
      model: chatModel,
      promptId: "coder",
      system: "RAW",
      message: "hola",
    });

    expect(messages[0]).toEqual({ role: "system", content: "RAW" });
  });

  it("falls back to prompts/default.md when nothing else is set", () => {
    const messages = buildMessages({ model: chatModel, message: "hola" });
    expect(messages[0]).toEqual({
      role: "system",
      content: getPrompt("default"),
    });
  });

  it("rejects a request with neither message nor messages", () => {
    expect(() => buildMessages({ model: chatModel })).toThrow(
      /Provide either 'message' or 'messages'/,
    );
  });
});
