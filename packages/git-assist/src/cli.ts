#!/usr/bin/env node
// git-assist: draft Conventional Commit messages and pull requests with a
// local model, in any git repository. Nothing is committed, pushed or opened
// until you confirm, and the repository's own git hooks still run.

import { readFileSync } from "node:fs";
import { loadSettings } from "./config.js";
import { COMMIT_HELP, runCommit } from "./commit.js";
import { PR_HELP, runPr } from "./pr.js";
import { git } from "./run.js";

const HELP = `git-assist <command> [options]

Commands:
  commit    draft a commit message for the staged changes
  pr        draft a pull request for the current branch

Run in any git repository with a model loaded in LM Studio (or any
OpenAI-compatible server). Settings, from highest precedence:
  environment and .env   GIT_ASSIST_MODEL, GIT_ASSIST_BASE_URL, GIT_ASSIST_BASE,
                         GIT_ASSIST_DIFF_CHARS, GIT_ASSIST_TIMEOUT_MS,
                         GIT_ASSIST_MAX_TOKENS
  .git-assist.json       the same settings, plus "packages" and "checks"
  the repo itself        commitlint config, release-please-config.json,
                         package.json scripts, PR template

${COMMIT_HELP}

${PR_HELP}`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "--version" || command === "-v") {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    console.log(pkg.version);
    return 0;
  }
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    console.log(HELP);
    return command ? 0 : 1;
  }
  if (command !== "commit" && command !== "pr") {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(command === "commit" ? COMMIT_HELP : PR_HELP);
    return 0;
  }

  let root: string;
  try {
    root = (await git("rev-parse", "--show-toplevel")).trim();
  } catch {
    console.error("Not inside a git repository.");
    return 1;
  }

  const settings = loadSettings(root);
  return command === "commit"
    ? runCommit(rest, settings)
    : runPr(rest, settings);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Bad flags and invalid config land here: one line, not a stack trace.
    console.error((error as Error).message);
    process.exitCode = 1;
  },
);
