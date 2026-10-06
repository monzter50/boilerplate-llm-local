# git-assist

Draft Conventional Commit messages and pull requests with a **local model**, in
any git repository. It runs on LM Studio by default, or on any OpenAI-compatible
server (Ollama, llama.cpp).

```bash
git add -p
git-assist commit          # draft → [y]es / [e]dit / [n]o → git commit
git-assist pr --draft      # run checks → draft → confirm → push → gh pr create
```

Nothing is committed, pushed or opened until you confirm, and the repository's
own git hooks still run.

## What it does, and what it doesn't leave to the model

- **The commit rules are the repository's own.** It reads the repo's commitlint
  config, the same one its `commit-msg` hook uses. A repo without one gets
  standard Conventional Commits.
- **A draft that breaks the rules goes back to the model** with commitlint's
  errors, up to three times. If it still fails, you can edit it, and the editor
  lists the problems as `#` lines that git removes.
- **Facts come from code, not from the model:**
  - The scope comes from the paths changed. An invented scope is replaced.
  - The packages touched and the checkbox ticks come from the paths and the
    rules.
  - "How it was tested" contains the real results of running the repo's
    checks.
- **The model writes only the prose:** the commit message, the PR title, the
  "what and why", and breaking changes. Read it before confirming: an 8B model
  can name things that aren't in the diff.

## Install

It isn't published to npm yet. Build it from this repository:

```bash
# in boilerplate-llm-local
pnpm install
pnpm build:git-assist

# use it in every repo on this machine
npm install -g ./packages/git-assist
git-assist --version
```

Inside this repository you don't need to install it: `pnpm commit` and
`pnpm pr` run it from source.

You also need:

- A model loaded in LM Studio, with the local server started
  (**Developer → Start Server**).
- For `git-assist pr`, the [GitHub CLI](https://cli.github.com), logged in with
  `gh auth login`.

## How it learns about a repository

Run it anywhere inside a repo, and it reads these from the repo root:

| What                | From                                                                                                       | Without it                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Commit types/scopes | `commitlint.config.*` (or `.commitlintrc*`, `package.json`)                                                | standard Conventional Commits         |
| Packages and scopes | `release-please-config.json` (components), or `packages` in `.git-assist.json`                             | no scope suggestion                   |
| PR body layout      | `.github/pull_request_template.md` (or the other usual locations)                                          | a plain What / Tested / Breaking body |
| Checks before a PR  | `typecheck`, `lint`, `format:check`, `test` scripts in `package.json`, run with the repo's package manager | the PR says no checks were found      |

PR templates are filled by heading:

- "What and why", "Summary" or "Description" get the model's text.
- "How it was tested" or "Test plan" get the check results.
- A "Packages" list gets its matching lines ticked.
- In a "Checklist", only the items the tool can verify get ticked.
- Any other section is kept as written.

## Settings

The environment wins, then the repo's `.env`, then `.git-assist.json`. Only the
keys below are read from `.env`. The rest of a project's `.env`, and its
secrets, are never loaded.

| Variable                | `.git-assist.json` | Default                    |
| ----------------------- | ------------------ | -------------------------- |
| `GIT_ASSIST_MODEL`      | `model`            | first chat model loaded    |
| `GIT_ASSIST_BASE_URL`   | `baseUrl`          | `http://localhost:1234/v1` |
| `GIT_ASSIST_BASE`       | `base`             | `main`                     |
| `GIT_ASSIST_DIFF_CHARS` | `diffChars`        | `6000`                     |
| `GIT_ASSIST_TIMEOUT_MS` | `timeoutMs`        | `300000`                   |
| `GIT_ASSIST_MAX_TOKENS` | `maxTokens`        | `4096`                     |

`LMSTUDIO_BASE_URL` also works as the server URL.

`.git-assist.json` can also replace what the repo declares:

```json
{
  "model": "google/gemma-4-12b-qat",
  "packages": { "api": "services/api", "web": "apps/web", "root": "." },
  "checks": [{ "name": "make test", "command": ["make", "test"] }]
}
```

## Picking a model

Non-reasoning models (Gemma, Qwen instruct) answer faster and stay closer to the
diff. Reasoning models (DeepSeek R1) think first, which costs time and tokens;
on a large diff they can run out of budget before answering. On a laptop, expect
about 1–2 minutes per draft.

If a draft times out:

- commit in smaller steps
- lower `GIT_ASSIST_DIFF_CHARS`
- raise `GIT_ASSIST_TIMEOUT_MS`

## Commands

```
git-assist commit [--dry-run] [--yes]
git-assist pr [--dry-run] [--draft] [--skip-checks] [--base <branch>] [--yes]
git-assist --help | --version
```

- `--dry-run` only prints the draft.
- `--yes` skips the confirmation, and only acts on a draft that passes the rules.
- Without a terminal to confirm in (a pipe, CI, an agent), it does nothing
  unless `--yes` is given.
