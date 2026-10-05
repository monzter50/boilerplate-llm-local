// git-assist commit: drafts a Conventional Commit message for the staged
// changes with a local model, checks it against the repo's commitlint rules,
// and commits after you confirm. The repo's git hooks still run.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Settings } from "./config.js";
import { NOISE_PATHSPECS, scopeHint, summarizeDiff } from "./context.js";
import {
  cleanModelOutput,
  describeRules,
  enforceScope,
  loadCommitRules,
  renderTemplate,
} from "./conventional.js";
import { generateValid } from "./generate.js";
import { connect } from "./model.js";
import { ask, git, runAttached } from "./run.js";

const log = (line = "") => console.error(line);

export const COMMIT_HELP = `git-assist commit [--dry-run] [--yes]

Drafts a commit message for the staged changes, then asks
[y]es / [e]dit / [n]o before running git commit.

  --dry-run   only print the message
  --yes       commit without asking (only a message that passes the rules)`;

export async function runCommit(
  argv: string[],
  settings: Settings,
): Promise<number> {
  const { values: flags } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });

  const files = (await git("diff", "--staged", "--name-only"))
    .split("\n")
    .filter(Boolean);
  if (files.length === 0) {
    log("Nothing is staged. Stage your changes with `git add` first.");
    return 1;
  }

  const diff = await git("diff", "--staged", "--", ".", ...NOISE_PATHSPECS);
  const summary = summarizeDiff(diff, settings.diffChars);

  const rules = await loadCommitRules(settings.root);
  if (rules.source === "default") {
    log(
      "No commitlint config in this repo: using standard Conventional Commits.",
    );
  }
  const scope = scopeHint(files, settings.packages, rules.scopes);
  const system = renderTemplate(
    readFileSync(new URL("../prompts/commit.md", import.meta.url), "utf8"),
    describeRules(rules),
  );

  const prompt = [
    `Staged files:\n${files.map((f) => `- ${f}`).join("\n")}`,
    scope ? `Suggested scope: ${scope}` : "",
    summary.truncated
      ? "The diff was shortened to fit; every file is listed, but long changes are cut."
      : "",
    `Diff:\n${summary.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let result;
  try {
    const { ask: askModel, model } = await connect(settings, system);
    log(`Drafting a commit message with ${model}...`);
    result = await generateValid({
      prompt,
      ask: askModel,
      parse: (answer) => enforceScope(cleanModelOutput(answer), rules, scope),
      validate: rules.lint,
      show: (message) => message,
      onAttempt: (n, attempt) => {
        if (!attempt.valid) {
          log(`Attempt ${n} failed the rules: ${attempt.errors.join("; ")}`);
        }
      },
    });
  } catch (error) {
    log((error as Error).message);
    return 1;
  }

  const message = result.value;
  log("");
  log("─".repeat(60));
  console.log(message);
  log("─".repeat(60));
  if (!result.valid) {
    log(
      `Still failing after ${result.attempts} attempts: ${result.errors.join("; ")}`,
    );
  }

  if (flags["dry-run"]) return result.valid ? 0 : 1;

  let choice: string | null;
  if (flags.yes) {
    if (!result.valid) {
      log(
        "Not committing: --yes only commits a message that passes the rules.",
      );
      return 1;
    }
    choice = "y";
  } else {
    choice = await ask(
      result.valid
        ? "Commit with this message? [y]es / [e]dit / [n]o: "
        : "Edit it before committing? [e]dit / [n]o: ",
    );
    if (choice === null) {
      log(
        "No terminal to confirm in. Re-run with --yes to commit without asking, " +
          "or --dry-run to only print the message.",
      );
      return 1;
    }
  }

  if (choice !== "y" && choice !== "e") {
    log("Not committed.");
    return 0;
  }
  if (choice === "y" && !result.valid) {
    log("Not committed: the message fails the rules. Choose [e]dit instead.");
    return 1;
  }

  // Through a file, so a multi-line message survives intact. -e opens the
  // editor with it; the commit-msg hook checks the final text either way.
  // When editing a draft that fails the rules, say what to fix right in the
  // editor. Git drops "#" lines from the final message.
  const notes =
    choice === "e" && !result.valid
      ? `\n# This draft fails the commit rules. Fix these before saving:\n` +
        result.errors.map((e) => `#   - ${e}\n`).join("") +
        (rules.scopes.length
          ? `# Allowed scopes: ${rules.scopes.join(", ")}\n`
          : "")
      : "";
  const dir = mkdtempSync(path.join(tmpdir(), "git-assist-"));
  const file = path.join(dir, "COMMIT_MSG");
  writeFileSync(file, `${message}\n${notes}`);
  try {
    return await runAttached("git", [
      "commit",
      "-F",
      file,
      ...(choice === "e" ? ["-e"] : []),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
