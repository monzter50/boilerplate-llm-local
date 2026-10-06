import { describe, expect, it, vi } from "vitest";
import { cleanModelOutput, loadCommitRules } from "./conventional.js";
import { generateValid } from "./generate.js";
import type { Ask, Turn } from "./model.js";

// This repo's commitlint.config.js, the rules a real run validates against.
const rules = await loadCommitRules(process.cwd());

/** An Ask that answers from a script, recording what it was sent. */
function scripted(...answers: string[]) {
  const calls: Turn[][] = [];
  const ask: Ask = vi.fn(async (turns: Turn[]) => {
    calls.push(structuredClone(turns));
    return answers[calls.length - 1] ?? answers.at(-1) ?? "";
  });
  return { ask, calls };
}

const run = (ask: Ask, maxAttempts?: number) =>
  generateValid({
    prompt: "Staged files: ...",
    ask,
    parse: cleanModelOutput,
    validate: rules.lint,
    show: (m) => m,
    maxAttempts,
  });

describe("generateValid", () => {
  it("returns the first answer that passes", async () => {
    const { ask, calls } = scripted("feat(sdk): add retry option");

    await expect(run(ask)).resolves.toMatchObject({
      value: "feat(sdk): add retry option",
      valid: true,
      attempts: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it("sends commitlint's errors back and accepts the fix", async () => {
    const { ask, calls } = scripted(
      "setup: Add retry",
      "feat(sdk): add retry option",
    );

    const result = await run(ask);

    expect(result).toMatchObject({ valid: true, attempts: 2 });
    const retry = calls[1]!;
    expect(retry.at(-2)).toEqual({
      role: "assistant",
      content: "setup: Add retry",
    });
    expect(retry.at(-1)?.content).toMatch(/type-enum/);
    expect(retry.at(-1)?.content).toContain("setup: Add retry");
  });

  it("gives up after maxAttempts, returning the last try for a human", async () => {
    const { ask, calls } = scripted("nope");

    const result = await run(ask, 2);

    expect(result).toMatchObject({ value: "nope", valid: false, attempts: 2 });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });
});
