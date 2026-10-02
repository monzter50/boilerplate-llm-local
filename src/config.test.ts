import { describe, expect, it } from "vitest";
import { parseModelFamilies } from "./config.js";

describe("parseModelFamilies", () => {
  it("is empty when MODEL_FAMILIES is unset or blank", () => {
    expect(parseModelFamilies(undefined)).toEqual({});
    expect(parseModelFamilies("  ")).toEqual({});
  });

  it("reads comma-separated id=family pairs, ids with slashes included", () => {
    expect(
      parseModelFamilies(" qwen/qwen3.5-9b=reasoner , my-model=chat,"),
    ).toEqual({ "qwen/qwen3.5-9b": "reasoner", "my-model": "chat" });
  });

  it("fails loudly on a typo instead of ignoring it", () => {
    expect(() => parseModelFamilies("qwen3=reasonr")).toThrow(
      /unknown family "reasonr" for "qwen3".*reasoner, reasoner-legacy, chat/,
    );
    expect(() => parseModelFamilies("just-a-model")).toThrow(
      /expected "model-id=family"/,
    );
  });
});
