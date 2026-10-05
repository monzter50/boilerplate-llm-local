import { describe, expect, it } from "vitest";
import { packagesTouched, scopeHint, summarizeDiff } from "./context.js";

describe("packagesTouched", () => {
  it("follows release-please's paths, the server being everything else", () => {
    expect(
      packagesTouched([
        "web/src/App.tsx",
        "src/app.ts",
        "sdk/src/index.ts",
        "packages/contracts/src/index.ts",
        "README.md",
      ]),
    ).toEqual(["server", "contracts", "sdk", "web"]);
  });

  it("does not count unknown packages/ folders as the server", () => {
    expect(packagesTouched(["packages/other/x.ts"])).toEqual([]);
  });
});

describe("scopeHint", () => {
  it("suggests the package when only one is touched", () => {
    expect(scopeHint(["sdk/src/index.ts", "sdk/package.json"])).toBe("sdk");
  });

  it("suggests nothing when the change spans packages", () => {
    expect(scopeHint(["sdk/src/index.ts", "src/app.ts"])).toBeUndefined();
  });
});

describe("summarizeDiff", () => {
  const fileDiff = (name: string, lines: number) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` +
    Array.from({ length: lines }, (_, i) => `+line ${i} of ${name}`).join(
      "\n",
    ) +
    "\n";

  it("leaves a diff that fits untouched", () => {
    const diff = fileDiff("a.ts", 3);
    expect(summarizeDiff(diff, 10_000)).toEqual({
      text: diff,
      truncated: false,
    });
  });

  it("keeps every file's header when it has to cut", () => {
    const diff = fileDiff("big.ts", 500) + fileDiff("small.ts", 2);
    const { text, truncated } = summarizeDiff(diff, 1_000);

    expect(truncated).toBe(true);
    expect(text).toContain("diff --git a/big.ts b/big.ts");
    expect(text).toContain("diff --git a/small.ts b/small.ts");
    expect(text).toContain("+line 1 of small.ts");
    expect(text).toMatch(/\[\.\.\. \d+ more lines of this file left out\]/);
    // Roughly within budget: each file gets an equal share plus its note.
    expect(text.length).toBeLessThan(1_200);
  });
});
