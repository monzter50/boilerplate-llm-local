import load from "@commitlint/load";
import lint from "@commitlint/lint";
import type { PackageName } from "./context.js";

type Config = Awaited<ReturnType<typeof load>>;

let cached: Promise<Config> | undefined;

/** commitlint.config.js, the same rules the commit-msg hook applies. */
function loadConfig(): Promise<Config> {
  cached ??= load({}, { cwd: process.cwd() });
  return cached;
}

/** The value of an enum rule such as ["error", "always", ["feat", ...]]. */
function enumOf(config: Config, rule: string): string[] {
  const value = config.rules[rule]?.[2];
  return Array.isArray(value) ? value.map(String) : [];
}

export async function allowedTypesAndScopes() {
  const config = await loadConfig();
  return {
    types: enumOf(config, "type-enum"),
    scopes: enumOf(config, "scope-enum"),
  };
}

export type LintResult = { valid: boolean; errors: string[] };

/** Checks a message exactly as the commit-msg hook will. Warnings pass. */
export async function lintMessage(message: string): Promise<LintResult> {
  const config = await loadConfig();
  const result = await lint(
    message,
    config.rules,
    config.parserPreset?.parserOpts
      ? { parserOpts: config.parserPreset.parserOpts as object }
      : {},
  );
  return {
    valid: result.valid,
    errors: result.errors.map((e) => `${e.message} [${e.name}]`),
  };
}

/** Fills {{types}} and {{scopes}} in a prompt template. */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`No value for {{${key}}}`);
    return value;
  });
}

/**
 * Small models wrap answers despite being told not to: code fences, quotes, a
 * "Commit message:" label. Strips those, keeping the message itself.
 */
export function cleanModelOutput(text: string): string {
  let out = text.trim();
  const fenced = /```[\w-]*\n([\s\S]*?)\n?```/.exec(out);
  if (fenced?.[1] !== undefined) out = fenced[1].trim();
  out = out.replace(/^(commit message|message|title)\s*:\s*/i, "");
  if (/^(["'`]).*\1$/s.test(out)) out = out.slice(1, -1).trim();

  const [first = "", ...rest] = out.split("\n");
  // Markdown on the header ("**feat: x**", "# feat: x", "`feat: x`") reads to
  // commitlint as a missing type, an error the model cannot connect to the
  // asterisks, so it is removed here instead of being retried.
  const header = first
    .replace(/^#+\s*/, "")
    .replace(/^(\*\*|__|\*|_|`)(.+)\1$/, "$2")
    .trim();
  // Git and GitHub need a blank line between the header and the body, or the
  // body is read as part of the subject.
  const body = rest.join("\n").replace(/^\s*\n/, "");
  out = body.trim() ? `${header}\n\n${body}` : header;

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Replaces a scope the rules don't allow ("scripts", "tooling", "api") with the
 * one computed from the changed paths, or drops it when the change spans
 * several packages. The scope is a fact about the paths, not a judgement, so
 * code decides it: models invent plausible scopes and retrying with
 * commitlint's error does not reliably stop them. Allowed scopes the model
 * picked (e.g. "deps") are kept.
 */
export function enforceScope(
  message: string,
  allowed: string[],
  hint: string | undefined,
): string {
  return message.replace(
    /^(\w+)\(([^)]*)\)(!?):/,
    (header, type: string, scope: string, bang: string) => {
      if (allowed.includes(scope)) return header;
      return hint ? `${type}(${hint})${bang}:` : `${type}${bang}:`;
    },
  );
}

export type PrDraft = { title: string; why: string; breaking: string };

/**
 * Reads the model's answer to prompts/pr.md: TITLE:, WHY: and BREAKING:
 * sections. A plain-text format, because an 8B model breaks JSON far more
 * often than it breaks labels.
 */
export function parsePrDraft(text: string): PrDraft {
  const cleaned = text.replace(/```[\w-]*\n?|```/g, "").trim();
  const section = (name: string) => {
    const match = new RegExp(
      // "TITLE:", "**TITLE**:" or "**TITLE:**" — the bold may close after the colon.
      `^\\s*\\**${name}\\**\\s*:\\s*\\**\\s*([\\s\\S]*?)(?=^\\s*\\**(TITLE|WHY|BREAKING)\\**\\s*:|$(?![\\s\\S]))`,
      "im",
    ).exec(cleaned);
    return match?.[1]?.trim() ?? "";
  };
  return {
    title: cleanModelOutput(section("TITLE").split("\n")[0] ?? ""),
    why: section("WHY"),
    breaking: section("BREAKING") || "None.",
  };
}

const PACKAGE_LABELS: Record<PackageName, string> = {
  server: "server (`src/`, `prompts/`)",
  contracts: "`@ia-local/contracts` (`packages/contracts/`)",
  sdk: "`@ia-local/sdk` (`sdk/`)",
  web: "web (`web/`)",
};

export type CheckResult = { name: string; ok: boolean; detail: string };

export type PrBody = {
  why: string;
  packages: PackageName[];
  /** null when the checks were skipped. */
  checks: CheckResult[] | null;
  breaking: string;
  titleValid: boolean;
};

const box = (checked: boolean) => (checked ? "[x]" : "[ ]");

/**
 * The body, in the sections of .github/pull_request_template.md. Only the
 * prose comes from the model; packages, test results and checklist boxes are
 * facts the script knows, so it writes them itself and ticks only what is true.
 */
export function renderPrBody(body: PrBody): string {
  const touched = new Set(body.packages);
  const packages = (Object.keys(PACKAGE_LABELS) as PackageName[])
    .map((name) => `- ${box(touched.has(name))} ${PACKAGE_LABELS[name]}`)
    .join("\n");

  const testing =
    body.checks === null
      ? "Checks were not run for this description (`--skip-checks`)."
      : body.checks
          .map(
            (c) =>
              `- ${c.ok ? "✅" : "❌"} \`${c.name}\`${c.detail ? `: ${c.detail}` : ""}`,
          )
          .join("\n");
  const allPassed = body.checks?.every((c) => c.ok) ?? false;

  return [
    "## What and why",
    "",
    body.why || "_Describe what changes and why._",
    "",
    "## Packages touched",
    "",
    packages,
    "",
    "## How it was tested",
    "",
    testing,
    "",
    "## Breaking changes",
    "",
    body.breaking,
    "",
    "## Checklist",
    "",
    `- ${box(body.titleValid)} Title is a Conventional Commit (\`type(scope): summary\`)`,
    `- ${box(allPassed)} \`pnpm typecheck\`, \`pnpm lint\`, \`pnpm format:check\` and \`pnpm test\` pass`,
    "- [ ] New behavior has tests; reusable helpers are in `test/utils/`",
    "- [ ] README / CONTRIBUTING updated if behavior or setup changed",
    "",
    "_Drafted with a local model by `pnpm pr`._",
    "",
  ].join("\n");
}
