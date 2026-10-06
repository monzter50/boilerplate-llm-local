// git-assist pr: drafts a pull request for the current branch with a local
// model, shows it, and after you confirm pushes the branch and opens the PR
// with gh. The model writes only the prose (title, what and why, breaking
// changes); packages, check results and checklist ticks are filled in from
// facts.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Settings } from "./config.js";
import {
  NOISE_PATHSPECS,
  packagesTouched,
  scopeHint,
  summarizeDiff,
} from "./context.js";
import {
  describeRules,
  enforceScope,
  loadCommitRules,
  parsePrDraft,
  renderPrBody,
  renderTemplate,
  type CheckResult,
} from "./conventional.js";
import { generateValid } from "./generate.js";
import { connect } from "./model.js";
import { ask, existingPr, git, runAttached, runCheck } from "./run.js";

const log = (line = "") => console.error(line);

export const PR_HELP = `git-assist pr [--dry-run] [--draft] [--skip-checks] [--base <branch>] [--yes]

Runs the repo's checks, drafts the PR, then asks before pushing the branch
and opening the PR with the GitHub CLI (gh).

  --dry-run        only print the draft
  --draft          open it as a draft PR
  --skip-checks    do not run the checks (the PR says so)
  --base <branch>  target branch (default: main, or GIT_ASSIST_BASE)
  --yes            push and open without asking (only with a valid title)`;

export async function runPr(
  argv: string[],
  settings: Settings,
): Promise<number> {
  const { values: flags } = parseArgs({
    args: argv,
    options: {
      base: { type: "string", default: settings.base },
      draft: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "skip-checks": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const base = flags.base;

  const branch = (await git("rev-parse", "--abbrev-ref", "HEAD")).trim();
  if (branch === base || branch === "HEAD") {
    log(
      `You are on ${branch}. Create a branch for the change first, e.g.\n` +
        `  git switch -c feat/short-topic`,
    );
    return 1;
  }

  // Compare against the remote base when there is one: a stale local base
  // would pull already-merged commits into the PR description.
  const remoteBase = `origin/${base}`;
  const baseRef = await git("rev-parse", "--verify", "--quiet", remoteBase)
    .then(() => remoteBase)
    .catch(() => base);

  const subjects = (await git("log", "--format=%s", `${baseRef}..HEAD`))
    .split("\n")
    .filter(Boolean);
  if (subjects.length === 0) {
    log(
      `${branch} has no commits that are not on ${baseRef}. Nothing to open.`,
    );
    return 1;
  }

  if ((await git("status", "--porcelain")).trim()) {
    log("Note: you have uncommitted changes. They are not part of this PR.");
  }

  const files = (await git("diff", "--name-only", `${baseRef}...HEAD`))
    .split("\n")
    .filter(Boolean);
  const diff = await git(
    "diff",
    `${baseRef}...HEAD`,
    "--",
    ".",
    ...NOISE_PATHSPECS,
  );
  const summary = summarizeDiff(diff, settings.diffChars);

  // Real results for "How it was tested", so the model never has to invent them.
  let checks: CheckResult[] | null = null;
  if (!flags["skip-checks"]) {
    checks = [];
    for (const check of settings.checks) {
      log(`Running ${check.name}...`);
      checks.push(await runCheck(check, settings.root));
    }
  }

  const rules = await loadCommitRules(settings.root);
  const scope = scopeHint(files, settings.packages, rules.scopes);
  const system = renderTemplate(
    readFileSync(new URL("../prompts/pr.md", import.meta.url), "utf8"),
    describeRules(rules),
  );

  const prompt = [
    `Branch: ${branch}, into ${base}`,
    `Commits (newest first):\n${subjects.map((s) => `- ${s}`).join("\n")}`,
    `Changed files:\n${files.map((f) => `- ${f}`).join("\n")}`,
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
    log(`Drafting the PR with ${model}...`);
    result = await generateValid({
      prompt,
      ask: askModel,
      parse: (answer) => {
        const draft = parsePrDraft(answer);
        return {
          ...draft,
          title: enforceScope(draft.title, rules, scope),
        };
      },
      validate: async (draft) => {
        const { valid, errors } = await rules.lint(draft.title);
        const all = draft.why
          ? errors
          : [...errors, "the WHY section is empty"];
        return { valid: valid && Boolean(draft.why), errors: all };
      },
      show: (draft) =>
        `TITLE: ${draft.title}\nWHY:\n${draft.why}\nBREAKING:\n${draft.breaking}`,
      onAttempt: (n, attempt) => {
        if (!attempt.valid)
          log(`Attempt ${n} failed: ${attempt.errors.join("; ")}`);
      },
    });
  } catch (error) {
    log((error as Error).message);
    return 1;
  }

  // One commit: squash merge makes its subject the commit on the base anyway,
  // and it already passed the commit-msg hook.
  let title = result.value.title;
  const onlySubject = subjects.length === 1 ? subjects[0] : undefined;
  if (onlySubject && (await rules.lint(onlySubject)).valid) title = onlySubject;
  const titleCheck = await rules.lint(title);

  const body = renderPrBody(settings.prTemplate, {
    why: result.value.why,
    breaking: result.value.breaking,
    touched: packagesTouched(files, settings.packages),
    packages: settings.packages,
    checks,
    titleValid: titleCheck.valid,
  });

  log("");
  log("─".repeat(60));
  console.log(title);
  console.log("");
  console.log(body);
  log("─".repeat(60));

  if (!titleCheck.valid) {
    log(`The title fails the commit rules: ${titleCheck.errors.join("; ")}`);
  }
  if (checks?.some((c) => !c.ok)) {
    log(
      "Some checks failed. CI will likely fail too; consider fixing them first.",
    );
  }

  if (flags["dry-run"]) return titleCheck.valid ? 0 : 1;
  if (!titleCheck.valid) {
    log(
      "Not opening a PR with an invalid title. Fix it, or open the PR by hand.",
    );
    return 1;
  }

  const existing = await existingPr(branch);
  if (existing === null) {
    log(
      "The GitHub CLI is missing or not logged in. Run `gh auth login` first.",
    );
    return 1;
  }
  if (existing) {
    log(`A PR for ${branch} already exists: ${existing}`);
    return 1;
  }

  if (!flags.yes) {
    const choice = await ask(
      `Push ${branch} and open this PR into ${base}${flags.draft ? " as a draft" : ""}? [y]es / [n]o: `,
    );
    if (choice === null) {
      log(
        "No terminal to confirm in. Re-run with --yes, or --dry-run to only print it.",
      );
      return 1;
    }
    if (choice !== "y") {
      log("Nothing pushed, no PR opened.");
      return 0;
    }
  }

  // The repo's pre-push hook, if any, runs here; a failure stops everything.
  if ((await runAttached("git", ["push", "-u", "origin", branch])) !== 0) {
    log("Push failed, so no PR was opened.");
    return 1;
  }

  const dir = mkdtempSync(path.join(tmpdir(), "git-assist-"));
  const bodyFile = path.join(dir, "PR_BODY.md");
  writeFileSync(bodyFile, body);
  try {
    return await runAttached("gh", [
      "pr",
      "create",
      "--base",
      base,
      "--head",
      branch,
      "--title",
      title,
      "--body-file",
      bodyFile,
      ...(flags.draft ? ["--draft"] : []),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
