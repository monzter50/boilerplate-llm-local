import { describe, expect, it } from "vitest";
import {
  packagesTouched,
  scopeHint,
  summarizeDiff,
  type PackageDef,
} from "./context.js";

// This repo's layout, as release-please-config.json declares it.
const monorepo: PackageDef[] = [
  { name: "server", path: ".", exclude: ["sdk", "web", "packages"] },
  { name: "contracts", path: "packages/contracts" },
  { name: "sdk", path: "sdk" },
  { name: "web", path: "web" },
];

describe("packagesTouched", () => {
  it("gives each file to the most specific package that contains it", () => {
    expect(
      packagesTouched(
        [
          "web/src/App.tsx",
          "src/app.ts",
          "sdk/src/index.ts",
          "packages/contracts/src/index.ts",
          "README.md",
        ],
        monorepo,
      ),
    ).toEqual(["server", "contracts", "sdk", "web"]);
  });

  it("leaves out files under an excluded folder no package claims", () => {
    expect(packagesTouched(["packages/other/x.ts"], monorepo)).toEqual([]);
  });

  it("works without exclude-paths: the specific folder still wins", () => {
    const simple: PackageDef[] = [
      { name: "app", path: "." },
      { name: "lib", path: "lib" },
    ];
    expect(packagesTouched(["lib/a.ts"], simple)).toEqual(["lib"]);
    expect(packagesTouched(["src/a.ts", "lib/a.ts"], simple)).toEqual([
      "app",
      "lib",
    ]);
  });

  it("knows nothing about a repo that declares no packages", () => {
    expect(packagesTouched(["src/a.ts"], [])).toEqual([]);
  });
});

describe("scopeHint", () => {
  const allowed = ["server", "sdk", "contracts", "web"];

  it("suggests the one package touched", () => {
    expect(scopeHint(["sdk/src/index.ts"], monorepo, allowed)).toBe("sdk");
  });

  it("suggests nothing when the change spans packages", () => {
    expect(
      scopeHint(["sdk/src/index.ts", "src/app.ts"], monorepo, allowed),
    ).toBeUndefined();
  });

  it("never suggests a scope the rules forbid, and any when all are allowed", () => {
    expect(scopeHint(["web/x.ts"], monorepo, ["sdk"])).toBeUndefined();
    expect(scopeHint(["web/x.ts"], monorepo, [])).toBe("web");
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
    expect(text.length).toBeLessThan(1_200);
  });
});
