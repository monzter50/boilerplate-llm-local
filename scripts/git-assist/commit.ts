// pnpm commit: drafts a Conventional Commit message for the staged changes
// with the local model, checks it with commitlint, and commits after you
// confirm. The husky hooks still run on the commit itself.
//
//   pnpm commit             draft, confirm (yes / edit / no), commit
//   pnpm commit --dry-run   only print the message
//   pnpm commit --yes       commit without asking (needs a valid message)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { scopeHint, summarizeDiff } from "./context.js";
import {
  allowedTypesAndScopes,
  cleanModelOutput,
  enforceScope,
  lintMessage,
  renderTemplate,
} from "./conventional.js";
import { generateValid, localModel } from "./generate.js";
import { ask, git, runAttached } from "./run.js";

const log = (line = "") => console.error(line);

const { values: flags } = parseArgs({
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
  process.exit(1);
}

// The lockfile and generated changelogs are noise to the model; they still
// show in the file list.
const diff = await git(
  "diff",
  "--staged",
  "--",
  ".",
  ":(exclude)pnpm-lock.yaml",
  ":(exclude,glob)**/CHANGELOG.md",
);
const budget = Number(process.env.GIT_ASSIST_DIFF_CHARS) || 6000;
const summary = summarizeDiff(diff, budget);
const scope = scopeHint(files);

const { types, scopes } = await allowedTypesAndScopes();
const system = renderTemplate(
  readFileSync(new URL("prompts/commit.md", import.meta.url), "utf8"),
  { types: types.join(", "), scopes: scopes.join(", ") },
);

const prompt = [
  `Staged files:\n${files.map((f) => `- ${f}`).join("\n")}`,
  scope
    ? `Suggested scope: ${scope}`
    : "Suggested scope: none (the change spans several packages)",
  summary.truncated
    ? "The diff was shortened to fit; every file is listed, but long changes are cut."
    : "",
  `Diff:\n${summary.text}`,
]
  .filter(Boolean)
  .join("\n\n");

const { ask: askModel, model } = await localModel(system);
log(`Drafting a commit message with ${model}...`);

const result = await generateValid({
  prompt,
  ask: askModel,
  parse: (answer) => enforceScope(cleanModelOutput(answer), scopes, scope),
  validate: lintMessage,
  show: (message) => message,
  onAttempt: (n, attempt) => {
    if (!attempt.valid) {
      log(`Attempt ${n} failed commitlint: ${attempt.errors.join("; ")}`);
    }
  },
}).catch((error: unknown) => {
  log((error as Error).message);
  process.exit(1);
});

const message = result.value;
log("");
log("─".repeat(60));
console.log(message);
log("─".repeat(60));
if (!result.valid) {
  log(
    `Still failing commitlint after ${result.attempts} attempts: ${result.errors.join("; ")}`,
  );
}

if (flags["dry-run"]) process.exit(result.valid ? 0 : 1);

let choice: string | null;
if (flags.yes) {
  if (!result.valid) {
    log("Not committing: --yes only commits a message that passes commitlint.");
    process.exit(1);
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
    process.exit(1);
  }
}

if (choice !== "y" && choice !== "e") {
  log("Not committed.");
  process.exit(0);
}
if (choice === "y" && !result.valid) {
  log("Not committed: the message fails commitlint. Choose [e]dit instead.");
  process.exit(1);
}

// Through a file, so a multi-line message survives intact. -e opens the
// editor with it; the commit-msg hook checks the final text either way.
const dir = mkdtempSync(path.join(tmpdir(), "git-assist-"));
const file = path.join(dir, "COMMIT_MSG");
// When editing a draft that fails commitlint, say what to fix right in the
// editor. Git drops "#" lines from the final message.
const notes =
  choice === "e" && !result.valid
    ? `\n# This draft fails the commit rules. Fix these before saving:\n` +
      result.errors.map((e) => `#   - ${e}\n`).join("") +
      `# Allowed scopes: ${scopes.join(", ")}\n`
    : "";
writeFileSync(file, `${message}\n${notes}`);
try {
  const args = ["commit", "-F", file, ...(choice === "e" ? ["-e"] : [])];
  process.exitCode = await runAttached("git", args);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
