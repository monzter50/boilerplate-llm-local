import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../../test/utils/fs.js";
import {
  classifyHeading,
  cleanModelOutput,
  enforceScope,
  loadCommitRules,
  parsePrDraft,
  renderPrBody,
  renderTemplate,
  type PrFacts,
} from "./conventional.js";

describe("loadCommitRules", () => {
  it("reads the repo's commitlint config, as its commit-msg hook does", async () => {
    // Tests run from this repo's root, with its commitlint.config.js.
    const rules = await loadCommitRules(process.cwd());

    expect(rules.source).toBe("repo");
    expect(rules.types).toContain("feat");
    expect(rules.types).not.toContain("setup");
    expect(rules.scopes).toContain("sdk");
    await expect(rules.lint("feat(sdk): add retry option")).resolves.toEqual({
      valid: true,
      errors: [],
    });
    const bad = await rules.lint("feat(api): Added stuff");
    expect(bad.errors.join(" ")).toMatch(/scope-enum/);
  });

  it("falls back to standard Conventional Commits in a repo without config", async () => {
    const { dir, cleanup } = tempDir({ "README.md": "# other project\n" });
    try {
      const rules = await loadCommitRules(dir);

      expect(rules.source).toBe("default");
      expect(rules.scopes).toEqual([]); // any scope goes
      expect((await rules.lint("feat(api): add endpoint")).valid).toBe(true);
      expect((await rules.lint("Added stuff")).valid).toBe(false);
    } finally {
      cleanup();
    }
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
  const allowed = {
    types: ["feat", "fix", "docs", "test", "build", "chore"],
    scopes: ["server", "sdk", "contracts", "web", "deps", "release"],
  };

  it("replaces an invented scope with the one from the paths", () => {
    // The header that failed the commit-msg hook in a real run.
    expect(
      enforceScope(
        "chore(scripts): Add support for pnpm commit command\n\nBody stays.",
        allowed,
        "server",
      ),
    ).toBe("chore(server): Add support for pnpm commit command\n\nBody stays.");
  });

  it("drops an invented scope when the change spans packages", () => {
    expect(enforceScope("feat(tooling)!: x", allowed, undefined)).toBe(
      "feat!: x",
    );
  });

  it("keeps allowed scopes, and any scope when the repo allows any", () => {
    expect(enforceScope("build(deps): bump zod", allowed, "server")).toBe(
      "build(deps): bump zod",
    );
    expect(enforceScope("feat(api): x", { types: [], scopes: [] }, "web")).toBe(
      "feat(api): x",
    );
  });

  it("turns a type used as the scope into the type", () => {
    // The header a real run drafted for README-only changes in four packages.
    expect(
      enforceScope(
        "feat(docs): add package list and API versioning\n\nBody stays.",
        allowed,
        undefined,
      ),
    ).toBe("docs: add package list and API versioning\n\nBody stays.");
    expect(enforceScope("chore(test)!: x", allowed, "sdk")).toBe(
      "test(sdk)!: x",
    );
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
  const facts: PrFacts = {
    why: "Adds retries.",
    breaking: "None.",
    touched: ["sdk"],
    packages: [
      { name: "server", path: "." },
      { name: "sdk", path: "sdk" },
    ],
    checks: [
      { name: "pnpm typecheck", ok: true, detail: "" },
      { name: "pnpm test", ok: true, detail: "Tests 78 passed (78)" },
    ],
    titleValid: true,
  };

  it("fills this repo's real template and ticks only what is true", () => {
    const template = readFileSync(
      new URL("../../../.github/pull_request_template.md", import.meta.url),
      "utf8",
    );
    const body = renderPrBody(template, facts);

    expect(body).not.toContain("<!--");
    expect(body).toMatch(/## What and why\n\nAdds retries\./);
    expect(body).toContain("- [x] `@ia-local/sdk` (`sdk/`)");
    expect(body).toContain("- [ ] web (`web/`)");
    expect(body).toContain("✅ `pnpm test`: Tests 78 passed (78)");
    expect(body).toMatch(/- \[x\] Title is a Conventional Commit/);
    expect(body).toMatch(/- \[x\] `pnpm typecheck`.*pass/);
    // Not something the script can know, so never ticked by it.
    expect(body).toMatch(/- \[ \] New behavior has tests/);
  });

  it("fills another project's template by what its headings ask for", () => {
    const body = renderPrBody(
      "## Summary\n\n<!-- what? -->\n\n## Test plan\n\n## Screenshots\n\nAdd if UI.\n",
      {
        ...facts,
        checks: [{ name: "npm run test", ok: false, detail: "failed: 1" }],
      },
    );

    expect(body).toMatch(/## Summary\n\nAdds retries\./);
    expect(body).toContain("❌ `npm run test`: failed: 1");
    // A section it doesn't know is kept as the template wrote it.
    expect(body).toContain("## Screenshots\n\nAdd if UI.");
  });

  it("uses a plain default without a template, saying when checks were skipped", () => {
    const body = renderPrBody(null, { ...facts, checks: null });

    expect(body).toMatch(/^## What and why/);
    expect(body).toContain("- [x] sdk (`sdk/`)");
    expect(body).toContain("- [ ] server (`root`)");
    expect(body).toContain("Checks were not run");
  });

  it("says so when the repo has no check scripts at all", () => {
    expect(renderPrBody(null, { ...facts, checks: [] })).toMatch(
      /No check scripts found/,
    );
  });
});

describe("classifyHeading", () => {
  it.each([
    ["## What and why", "why"],
    ["## Summary", "why"],
    ["## Description", "why"],
    ["## How it was tested", "testing"],
    ["### Test plan", "testing"],
    ["## Packages touched", "packages"],
    ["## Breaking changes", "breaking"],
    ["## Checklist", "checklist"],
    ["## Screenshots", "other"],
  ])("%s → %s", (heading, kind) => {
    expect(classifyHeading(heading)).toBe(kind);
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
