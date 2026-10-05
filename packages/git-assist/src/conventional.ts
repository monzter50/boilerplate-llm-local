import { createRequire } from "node:module";
import load from "@commitlint/load";
import lint from "@commitlint/lint";
import type { PackageDef } from "./context.js";

type Config = Awaited<ReturnType<typeof load>>;

export type CommitRules = {
  /** Allowed types; empty when the repo allows any. */
  types: string[];
  /** Allowed scopes; empty when the repo allows any. */
  scopes: string[];
  /** Whether the rules came from the repo or from the bundled default. */
  source: "repo" | "default";
  lint: (message: string) => Promise<LintResult>;
};

export type LintResult = { valid: boolean; errors: string[] };

/** The value of an enum rule such as ["error", "always", ["feat", ...]]. */
function enumOf(config: Config, rule: string): string[] {
  const value = config.rules[rule]?.[2];
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * The repo's commitlint config, the same rules its commit-msg hook applies.
 * A repo without one gets @commitlint/config-conventional, resolved from this
 * package, so the target repo does not need it installed.
 */
export async function loadCommitRules(root: string): Promise<CommitRules> {
  let config = await load({}, { cwd: root });
  let source: CommitRules["source"] = "repo";
  if (Object.keys(config.rules).length === 0) {
    const conventional = createRequire(import.meta.url).resolve(
      "@commitlint/config-conventional",
    );
    config = await load({ extends: [conventional] }, { cwd: root });
    source = "default";
  }

  const parserOpts = config.parserPreset?.parserOpts as object | undefined;
  return {
    types: enumOf(config, "type-enum"),
    scopes: enumOf(config, "scope-enum"),
    source,
    async lint(message) {
      const result = await lint(
        message,
        config.rules,
        parserOpts ? { parserOpts } : {},
      );
      return {
        valid: result.valid,
        errors: result.errors.map((e) => `${e.message} [${e.name}]`),
      };
    },
  };
}

/** Fills {{placeholders}} in a prompt template. */
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

/** The prompt lines that describe the repo's types and scopes. */
export function describeRules(rules: Pick<CommitRules, "types" | "scopes">) {
  return {
    types: rules.types.length
      ? rules.types.join(", ")
      : "feat, fix, perf, refactor, docs, test, build, ci, chore, revert",
    scopes: rules.scopes.length
      ? `one of: ${rules.scopes.join(", ")}`
      : "a short lowercase noun naming the area changed",
  };
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
 * commitlint's error does not reliably stop them. When the repo allows any
 * scope, the model's choice stands.
 *
 * A scope that is really a type ("feat(docs)", "chore(test)") is the model
 * putting the type in the wrong slot, so it becomes the type.
 */
export function enforceScope(
  message: string,
  rules: Pick<CommitRules, "types" | "scopes">,
  hint: string | undefined,
): string {
  if (rules.scopes.length === 0) return message;
  return message.replace(
    /^(\w+)\(([^)]*)\)(!?):/,
    (header, type: string, scope: string, bang: string) => {
      if (rules.scopes.includes(scope)) return header;
      const fixedType = rules.types.includes(scope) ? scope : type;
      return hint ? `${fixedType}(${hint})${bang}:` : `${fixedType}${bang}:`;
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

export type CheckResult = { name: string; ok: boolean; detail: string };

export type PrFacts = {
  why: string;
  breaking: string;
  /** Names of the packages touched; empty when the repo has none declared. */
  touched: string[];
  /** Every package the repo declares, to label the default body. */
  packages: PackageDef[];
  /** null when the checks were skipped; empty when the repo has none. */
  checks: CheckResult[] | null;
  titleValid: boolean;
};

const FOOTER = "_Drafted with a local model by git-assist._";

function testingText(checks: CheckResult[] | null): string {
  if (checks === null)
    return "Checks were not run for this description (`--skip-checks`).";
  if (checks.length === 0) {
    return "_No check scripts found (typecheck, lint, format:check, test). Describe how this was tested._";
  }
  return checks
    .map(
      (c) =>
        `- ${c.ok ? "✅" : "❌"} \`${c.name}\`${c.detail ? `: ${c.detail}` : ""}`,
    )
    .join("\n");
}

const allPassed = (checks: CheckResult[] | null) =>
  checks !== null && checks.length > 0 && checks.every((c) => c.ok);

type SectionKind =
  "why" | "packages" | "testing" | "breaking" | "checklist" | "other";

/** What a template section is for, judged by its heading. */
export function classifyHeading(heading: string): SectionKind {
  const h = heading.toLowerCase();
  if (/breaking/.test(h)) return "breaking";
  if (/checklist|check list/.test(h)) return "checklist";
  if (/test|verif|\bqa\b/.test(h)) return "testing";
  if (/package|component|affected|area/.test(h)) return "packages";
  if (
    /what|why|summary|description|overview|context|motivation|changes/.test(h)
  ) {
    return "why";
  }
  return "other";
}

const box = (checked: boolean) => (checked ? "[x]" : "[ ]");
const tick = (line: string, checked: boolean) =>
  checked ? line.replace(/^(\s*[-*]\s*)\[ \]/, "$1[x]") : line;

/** Ticks a checklist line only when the script knows it is true. */
function tickChecklistLine(line: string, facts: PrFacts): string {
  if (!/^\s*[-*]\s*\[ \]/.test(line)) return line;
  if (/conventional|title/i.test(line)) return tick(line, facts.titleValid);
  if (
    /(typecheck|lint|test|check)[^\n]*pass|pass[^\n]*(test|check)/i.test(line)
  ) {
    return tick(line, allPassed(facts.checks));
  }
  return line;
}

/** Ticks the template's own package lines that name a touched package. */
function tickPackageLines(body: string, touched: string[]): string | null {
  const lines = body.split("\n");
  if (!lines.some((l) => /^\s*[-*]\s*\[ \]/.test(l))) return null;
  return lines
    .map((line) =>
      tick(
        line,
        touched.some((name) =>
          new RegExp(
            `(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`,
            "i",
          ).test(line.replace(/^\s*[-*]\s*\[ \]/, "")),
        ),
      ),
    )
    .join("\n");
}

/**
 * The PR body. With the repo's template, each section is filled by what its
 * heading asks for and the rest of the template is kept as written; without
 * one, a plain default. Only the prose (why, breaking) comes from the model:
 * packages, check results and checklist ticks are facts the script knows, so it
 * writes them itself and ticks only what is true.
 */
export function renderPrBody(template: string | null, facts: PrFacts): string {
  const why = facts.why || "_Describe what changes and why._";
  if (template === null) return defaultBody(facts, why);

  const cleaned = template.replace(/<!--[\s\S]*?-->/g, "");
  const parts = cleaned.split(/^(?=#{1,3} )/m);

  const out = parts.map((part) => {
    const [heading = "", ...rest] = part.split("\n");
    if (!/^#{1,3} /.test(heading)) return part.trim();
    const body = rest.join("\n").trim();
    switch (classifyHeading(heading)) {
      case "why":
        return `${heading}\n\n${why}`;
      case "breaking":
        return `${heading}\n\n${facts.breaking}`;
      case "testing":
        return `${heading}\n\n${testingText(facts.checks)}`;
      case "packages": {
        const ticked = tickPackageLines(body, facts.touched);
        const list =
          ticked ??
          (facts.touched.map((name) => `- ${name}`).join("\n") || body);
        return `${heading}\n\n${list}`;
      }
      case "checklist":
        return `${heading}\n\n${body
          .split("\n")
          .map((line) => tickChecklistLine(line, facts))
          .join("\n")}`;
      default:
        return body ? `${heading}\n\n${body}` : heading;
    }
  });

  return `${out.filter(Boolean).join("\n\n")}\n\n${FOOTER}\n`;
}

function defaultBody(facts: PrFacts, why: string): string {
  const sections = [`## What and why\n\n${why}`];
  if (facts.packages.length > 0) {
    const touched = new Set(facts.touched);
    sections.push(
      `## Packages touched\n\n${facts.packages
        .map(
          (p) =>
            `- ${box(touched.has(p.name))} ${p.name} (\`${p.path === "." ? "root" : `${p.path}/`}\`)`,
        )
        .join("\n")}`,
    );
  }
  sections.push(
    `## How it was tested\n\n${testingText(facts.checks)}`,
    `## Breaking changes\n\n${facts.breaking}`,
  );
  return `${sections.join("\n\n")}\n\n${FOOTER}\n`;
}
