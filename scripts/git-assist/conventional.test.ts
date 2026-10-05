import { describe, expect, it } from "vitest";
import {
  allowedTypesAndScopes,
  cleanModelOutput,
  enforceScope,
  lintMessage,
  parsePrDraft,
  renderPrBody,
  renderTemplate,
} from "./conventional.js";

describe("commitlint rules", () => {
  it("come from commitlint.config.js, the same as the commit-msg hook", async () => {
    const { types, scopes } = await allowedTypesAndScopes();
    expect(types).toContain("feat");
    expect(types).not.toContain("setup");
    expect(scopes).toEqual([
      "server",
      "sdk",
      "contracts",
      "web",
      "deps",
      "release",
    ]);
  });

  it("accept a valid message and explain an invalid one", async () => {
    await expect(lintMessage("feat(sdk): add retry option")).resolves.toEqual({
      valid: true,
      errors: [],
    });

    const bad = await lintMessage("feat(api): Added stuff");
    expect(bad.valid).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/scope-enum/);
  });
});

describe("cleanModelOutput", () => {
  it("unwraps the fences, labels and quotes small models add", () => {
    expect(cleanModelOutput("```\nfix: handle empty answer\n```")).toBe(
      "fix: handle empty answer",
    );
    expect(cleanModelOutput("Commit message: fix: x")).toBe("fix: x");
    expect(cleanModelOutput('"docs: update readme"')).toBe(
      "docs: update readme",
    );
  });

  it("strips markdown from the header, as the local model produced it", () => {
    // Verbatim shape of a real DeepSeek R1 8B answer that failed 3 retries.
    expect(
      cleanModelOutput(
        "**feat(server): Add scripts for commit messages**\nThis change adds scripts.",
      ),
    ).toBe(
      "feat(server): Add scripts for commit messages\n\nThis change adds scripts.",
    );
    expect(cleanModelOutput("# fix: x")).toBe("fix: x");
    expect(cleanModelOutput("`docs: y`")).toBe("docs: y");
  });

  it("keeps a body, with at most one blank line between paragraphs", () => {
    expect(cleanModelOutput("feat: x\n\n\n\nBecause y.")).toBe(
      "feat: x\n\nBecause y.",
    );
  });
});

describe("enforceScope", () => {
  const allowed = ["server", "sdk", "contracts", "web", "deps", "release"];

  it("replaces an invented scope with the one from the paths", async () => {
    // The header that failed the commit-msg hook in a real run.
    const fixed = enforceScope(
      "chore(scripts): Add support for pnpm commit command\n\nBody stays.",
      allowed,
      "server",
    );
    expect(fixed).toBe(
      "chore(server): Add support for pnpm commit command\n\nBody stays.",
    );
    await expect(lintMessage(fixed)).resolves.toMatchObject({ valid: true });
  });

  it("drops an invented scope when the change spans packages", () => {
    expect(enforceScope("feat(tooling)!: x", allowed, undefined)).toBe(
      "feat!: x",
    );
  });

  it("keeps an allowed scope the model chose, and messages without one", () => {
    expect(enforceScope("build(deps): bump zod", allowed, "server")).toBe(
      "build(deps): bump zod",
    );
    expect(enforceScope("fix: x", allowed, "sdk")).toBe("fix: x");
  });
});

describe("parsePrDraft", () => {
  it("reads the three labelled sections", () => {
    expect(
      parsePrDraft(
        "TITLE: feat(sdk): add retry\nWHY:\nRetries once.\nIt helps.\nBREAKING:\nNone.",
      ),
    ).toEqual({
      title: "feat(sdk): add retry",
      why: "Retries once.\nIt helps.",
      breaking: "None.",
    });
  });

  it("copes with bold labels, fences and a missing BREAKING", () => {
    expect(
      parsePrDraft("```\n**TITLE:** fix: x\n**WHY:**\nBecause.\n```"),
    ).toEqual({ title: "fix: x", why: "Because.", breaking: "None." });
  });
});

describe("renderPrBody", () => {
  it("ticks only what is known to be true", () => {
    const body = renderPrBody({
      why: "Adds retries.",
      packages: ["sdk"],
      checks: [
        { name: "pnpm typecheck", ok: true, detail: "" },
        { name: "pnpm test", ok: true, detail: "Tests 78 passed (78)" },
      ],
      breaking: "None.",
      titleValid: true,
    });

    expect(body).toContain("- [x] `@ia-local/sdk` (`sdk/`)");
    expect(body).toContain("- [ ] web (`web/`)");
    expect(body).toContain("✅ `pnpm test`: Tests 78 passed (78)");
    expect(body).toMatch(/- \[x\] Title is a Conventional Commit/);
    expect(body).toMatch(/- \[x\] `pnpm typecheck`.*pass/);
    // Not checkable by the script, so never ticked by it.
    expect(body).toMatch(/- \[ \] New behavior has tests/);
  });

  it("says plainly when checks failed or were skipped", () => {
    const failed = renderPrBody({
      why: "x",
      packages: [],
      checks: [{ name: "pnpm lint", ok: false, detail: "failed: 1 error" }],
      breaking: "None.",
      titleValid: true,
    });
    expect(failed).toContain("❌ `pnpm lint`: failed: 1 error");
    expect(failed).toMatch(/- \[ \] `pnpm typecheck`.*pass/);

    const skipped = renderPrBody({
      why: "x",
      packages: [],
      checks: null,
      breaking: "None.",
      titleValid: false,
    });
    expect(skipped).toContain("Checks were not run");
  });
});

describe("renderTemplate", () => {
  it("fills placeholders and refuses a missing one", () => {
    expect(renderTemplate("types: {{types}}", { types: "feat, fix" })).toBe(
      "types: feat, fix",
    );
    expect(() => renderTemplate("{{scopes}}", {})).toThrow(/scopes/);
  });
});
