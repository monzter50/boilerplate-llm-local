// pnpm pr: drafts a pull request for the current branch with the local model,
// shows it, and after you confirm pushes the branch and opens the PR with gh.
// The model writes only the prose (title, what and why, breaking changes);
// packages, check results and checklist ticks are filled in from facts.
//
//   pnpm pr                  run the checks, draft, confirm, push, open
//   pnpm pr --dry-run        only print the draft
//   pnpm pr --draft          open it as a draft PR
//   pnpm pr --skip-checks    do not run typecheck/lint/format/test first
//   pnpm pr --base <branch>  target another branch (default: main)
//   pnpm pr --yes            push and open without asking (needs a valid title)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { packagesTouched, scopeHint, summarizeDiff } from "./context.js";
import {
  allowedTypesAndScopes,
  enforceScope,
  lintMessage,
  parsePrDraft,
  renderPrBody,
  renderTemplate,
  type CheckResult,
} from "./conventional.js";
import { generateValid, localModel } from "./generate.js";
import { ask, existingPr, git, runAttached, runCheck } from "./run.js";

const log = (line = "") => console.error(line);

const { values: flags } = parseArgs({
  options: {
    base: { type: "string", default: "main" },
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
  process.exit(1);
}

// Compare against the remote base when there is one: a stale local main would
// pull already-merged commits into the PR description.
const remoteBase = `origin/${base}`;
const baseRef = await git("rev-parse", "--verify", "--quiet", remoteBase)
  .then(() => remoteBase)
  .catch(() => base);

const subjects = (await git("log", "--format=%s", `${baseRef}..HEAD`))
  .split("\n")
  .filter(Boolean);
if (subjects.length === 0) {
  log(`${branch} has no commits that are not on ${baseRef}. Nothing to open.`);
  process.exit(1);
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
  ":(exclude)pnpm-lock.yaml",
  ":(exclude,glob)**/CHANGELOG.md",
);
const budget = Number(process.env.GIT_ASSIST_DIFF_CHARS) || 6000;
const summary = summarizeDiff(diff, budget);
const scope = scopeHint(files);

// Real results for "How it was tested", so the model never has to invent them.
let checks: CheckResult[] | null = null;
if (!flags["skip-checks"]) {
  checks = [];
  for (const [name, args] of [
    ["pnpm typecheck", ["typecheck"]],
    ["pnpm lint", ["lint"]],
    ["pnpm format:check", ["format:check"]],
    ["pnpm test", ["test"]],
  ] as const) {
    log(`Running ${name}...`);
    checks.push(await runCheck(name, [...args]));
  }
}

const { types, scopes } = await allowedTypesAndScopes();
const system = renderTemplate(
  readFileSync(new URL("prompts/pr.md", import.meta.url), "utf8"),
  { types: types.join(", "), scopes: scopes.join(", ") },
);

const prompt = [
  `Branch: ${branch}, into ${base}`,
  `Commits (newest first):\n${subjects.map((s) => `- ${s}`).join("\n")}`,
  `Changed files:\n${files.map((f) => `- ${f}`).join("\n")}`,
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
log(`Drafting the PR with ${model}...`);

const result = await generateValid({
  prompt,
  ask: askModel,
  parse: (answer) => {
    const draft = parsePrDraft(answer);
    return { ...draft, title: enforceScope(draft.title, scopes, scope) };
  },
  validate: async (draft) => {
    const { valid, errors } = await lintMessage(draft.title);
    const all = draft.why ? errors : [...errors, "the WHY section is empty"];
    return { valid: valid && Boolean(draft.why), errors: all };
  },
  show: (draft) =>
    `TITLE: ${draft.title}\nWHY:\n${draft.why}\nBREAKING:\n${draft.breaking}`,
  onAttempt: (n, attempt) => {
    if (!attempt.valid)
      log(`Attempt ${n} failed: ${attempt.errors.join("; ")}`);
  },
}).catch((error: unknown) => {
  log((error as Error).message);
  process.exit(1);
});

// One commit: squash merge makes its subject the commit on main anyway, and it
// already passed the commit-msg hook.
let title = result.value.title;
const onlySubject = subjects.length === 1 ? subjects[0] : undefined;
if (onlySubject && (await lintMessage(onlySubject)).valid) title = onlySubject;
const titleValid = (await lintMessage(title)).valid;

const body = renderPrBody({
  why: result.value.why,
  packages: packagesTouched(files),
  checks,
  breaking: result.value.breaking,
  titleValid,
});

log("");
log("─".repeat(60));
console.log(title);
console.log("");
console.log(body);
log("─".repeat(60));

if (!titleValid) {
  log(
    `The title fails commitlint: ${(await lintMessage(title)).errors.join("; ")}`,
  );
}
if (checks?.some((c) => !c.ok)) {
  log("Some checks failed. CI will fail too; consider fixing them first.");
}

if (flags["dry-run"]) process.exit(titleValid ? 0 : 1);
if (!titleValid) {
  log(
    "Not opening a PR with an invalid title. Fix it, or open the PR by hand.",
  );
  process.exit(1);
}

const existing = await existingPr(branch);
if (existing === null) {
  log("The GitHub CLI is missing or not logged in. Run `gh auth login` first.");
  process.exit(1);
}
if (existing) {
  log(`A PR for ${branch} already exists: ${existing}`);
  process.exit(1);
}

if (!flags.yes) {
  const choice = await ask(
    `Push ${branch} and open this PR into ${base}${flags.draft ? " as a draft" : ""}? [y]es / [n]o: `,
  );
  if (choice === null) {
    log(
      "No terminal to confirm in. Re-run with --yes, or --dry-run to only print it.",
    );
    process.exit(1);
  }
  if (choice !== "y") {
    log("Nothing pushed, no PR opened.");
    process.exit(0);
  }
}

// The pre-push hook runs typecheck and tests here; a failure stops everything.
if ((await runAttached("git", ["push", "-u", "origin", branch])) !== 0) {
  log("Push failed, so no PR was opened.");
  process.exit(1);
}

const dir = mkdtempSync(path.join(tmpdir(), "git-assist-"));
const bodyFile = path.join(dir, "PR_BODY.md");
writeFileSync(bodyFile, body);
try {
  const args = [
    "pr",
    "create",
    "--base",
    base,
    "--head",
    branch,
    "--title",
    title,
  ];
  args.push("--body-file", bodyFile, ...(flags.draft ? ["--draft"] : []));
  process.exitCode = await runAttached("gh", args);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
