import { describe, expect, it } from "vitest";
import { testSummary } from "./run.js";

describe("testSummary", () => {
  it("quotes the runner's count, not npm's echo of the command", () => {
    // Real npm output: the command line is echoed before the script runs.
    const npm = [
      "> other-project@1.0.0 test",
      "> node -e \"console.log('Tests 3 passed (3)')\"",
      "",
      "Tests 3 passed (3)",
    ].join("\n");
    expect(testSummary(npm)).toBe("Tests 3 passed (3)");
  });

  it("keeps vitest's mixed result and spacing-free form", () => {
    expect(
      testSummary(
        " Test Files  2 passed (2)\n      Tests  1 failed | 77 passed (78)\n",
      ),
    ).toBe("Tests 1 failed | 77 passed (78)");
  });

  it("returns nothing when there is no count to quote", () => {
    expect(testSummary("All good")).toBe("");
  });
});
