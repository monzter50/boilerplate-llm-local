import { describe, expect, it } from "vitest";
import { explain, pickChatModel, stripThinking } from "./model.js";

describe("stripThinking", () => {
  it("drops inline reasoning, with or without the opening tag", () => {
    expect(stripThinking("<think>hmm</think>\n\nfeat: x")).toBe("feat: x");
    // Chat templates that inject "<think>" leave only the closing tag.
    expect(stripThinking("hmm, the diff adds\n</think>\nfix: y")).toBe(
      "fix: y",
    );
    expect(stripThinking("docs: z")).toBe("docs: z");
  });
});

describe("pickChatModel", () => {
  it("skips embedding models, which cannot write a message", () => {
    expect(
      pickChatModel(["text-embedding-nomic-embed-text-v1.5", "google/gemma-4"]),
    ).toBe("google/gemma-4");
    expect(pickChatModel(["text-embedding-x"])).toBeUndefined();
  });
});

describe("explain", () => {
  const settings = { baseUrl: "http://localhost:1234/v1", timeoutMs: 300_000 };
  const named = (name: string) => Object.assign(new Error("x"), { name });

  it("says what to do on a timeout and when the server is down", () => {
    expect(explain(named("APIConnectionTimeoutError"), settings, "m")).toMatch(
      /did not answer within 300s.*GIT_ASSIST_MODEL/s,
    );
    expect(explain(named("APIConnectionError"), settings, "m")).toMatch(
      /Cannot reach a model server at http:\/\/localhost:1234\/v1/,
    );
  });
});
