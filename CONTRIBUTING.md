# Contributing

Thanks for helping out. This page covers the setup, the checks a change has
to pass, and how commit messages turn into versions and changelogs.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm test        # passes with LM Studio closed
```

See the [README](README.md) for running the API, the CLI and the web chat.

## Before opening a pull request

CI runs the same commands, on Node 22 and 24:

```bash
pnpm typecheck
pnpm lint
pnpm format:check   # `pnpm format` fixes it
pnpm test
```

Reusable test helpers go in `test/utils/`, not inline in a test file.

### Git hooks

`pnpm install` sets up [husky](https://typicode.github.io/husky) hooks that run
most of these checks for you:

| Hook         | Runs                                                     | Time       |
| ------------ | -------------------------------------------------------- | ---------- |
| `pre-commit` | ESLint `--fix` and Prettier on the **staged** files only | ~1 s       |
| `commit-msg` | commitlint: the message must be a Conventional Commit    | instant    |
| `pre-push`   | `pnpm typecheck` and `pnpm test`                         | a few secs |

- Fixes made by the pre-commit hook are added to the commit automatically. An
  error it cannot fix, such as an unused variable, stops the commit.
- To skip the hooks once, use `git commit --no-verify` or
  `git push --no-verify`. To turn them off entirely, set `HUSKY=0`.
- CI runs every check anyway, so the hooks only save you a round trip.

The commit rules live in `commitlint.config.js`. Keep its types and scopes in
sync with `.github/workflows/pr-title.yml`.

If you use Claude Code, `CLAUDE.md` gives it the same commit conventions. A
project hook in `.claude/settings.json` also stops it from bypassing these
hooks (`--no-verify`, `git commit -n`, `HUSKY=0`, a changed `core.hooksPath`).

## Commit messages and PR titles

Pull requests are **squash-merged**, so the PR title becomes the commit on
`main`. Titles follow [Conventional Commits](https://www.conventionalcommits.org),
and a check fails the PR when they don't:

```
<type>(<optional scope>): <summary>
```

| Type                                      | Goes in the changelog as | Bumps                                  |
| ----------------------------------------- | ------------------------ | -------------------------------------- |
| `feat`                                    | Features                 | minor                                  |
| `fix`                                     | Bug Fixes                | patch                                  |
| `perf`                                    | Performance              | patch                                  |
| `refactor`                                | Refactoring              | patch                                  |
| `docs`                                    | Documentation            | patch                                  |
| `revert`                                  | Reverts                  | patch                                  |
| `test`, `build`, `ci`, `chore`            | hidden                   | nothing                                |
| `!` after the type, or `BREAKING CHANGE:` | Breaking changes         | major (minor while the version is 0.x) |

The scope names the package: `server`, `sdk`, `contracts`, `web`, plus
`deps` and `release`. It is optional, because which package a change belongs to
is decided by **the paths it touches**, not by the scope.

Examples:

```
feat(sdk): add retry option to chatStream
fix(server): release the generation slot when the model cannot be resolved
feat(contracts)!: rename modelInfo to answeredBy in ChatResponse
```

## Opening a pull request

1. **Branch from an up-to-date `main`.** If you don't have write access, fork
   the repository first and branch in your fork. Name the branch
   `<type>/<short-topic>`, for example `feat/sdk-retry` or
   `fix/stream-slot-release`.

   ```bash
   git switch main && git pull
   git switch -c feat/sdk-retry
   ```

2. **Commit** in small Conventional Commits. The hooks format, lint and check
   each message as you go.

3. **Push.** The pre-push hook runs typecheck and tests first.

   ```bash
   git push -u origin feat/sdk-retry
   ```

4. **Open the PR against `main`**, on GitHub or with the
   [GitHub CLI](https://cli.github.com):

   ```bash
   gh pr create --base main --title "feat(sdk): add retry option to chatStream"
   ```

   - The title must be a Conventional Commit; the "PR title" check fails
     otherwise. Fixing the title re-runs it, with no new commit needed.
   - Fill in the template: what and why, the packages touched, how you tested
     it, and any breaking change.
   - Open it as a draft (`gh pr create --draft`) if it isn't ready for review.

5. **Get CI green and a review.** Push fixes to the same branch. Don't
   force-push once review has started, so reviewers can see what changed.

6. **Squash merge.** The PR title becomes the single commit on `main`, so
   re-read it before merging. Then delete the branch.

Keep a PR to one change. Two unrelated fixes are two PRs, and two changelog
entries. Never edit versions or `CHANGELOG.md` files in a PR: release-please
owns them.

### Drafting with your local model

`pnpm commit` and `pnpm pr` draft commit messages and PRs with the model you
have loaded in LM Studio. Nothing is committed, pushed or opened until you
confirm, and the husky hooks still run.

```bash
git add -p
pnpm commit              # draft → [y]es / [e]dit / [n]o → git commit
pnpm pr --draft          # run checks → draft → confirm → push → gh pr create
pnpm commit --dry-run    # only print the message (also: pnpm pr --dry-run)
```

- **Rules come from `commitlint.config.js`**, the same as the hook. A draft
  that fails is sent back to the model with commitlint's errors, up to three
  times.
- **The model writes only the prose:** the title, "What and why" and breaking
  changes. The packages touched, the real check results and the checklist ticks
  come from the script, so the PR never claims tests that did not run.
- **Read the draft before confirming.** An 8B model can invent details that are
  not in the diff, for example naming a tool the change does not use.
- It takes 40–110 seconds per draft on a laptop. Set `GIT_ASSIST_MODEL` in
  `.env` to pick a different loaded model.

## Versions and releases

Each package has its own version, tag and `CHANGELOG.md`:

| Package               | Path                  | Tag                |
| --------------------- | --------------------- | ------------------ |
| `ia-local` (server)   | `.` (src/, prompts/…) | `server-v0.2.0`    |
| `@ia-local/contracts` | `packages/contracts`  | `contracts-v0.2.0` |
| `@ia-local/sdk`       | `sdk`                 | `sdk-v0.2.0`       |
| `web`                 | `web`                 | `web-v0.2.0`       |

Releases are automated with [release-please](https://github.com/googleapis/release-please):

1. Every push to `main` updates a single open **release PR**. It shows the next
   version of each package that changed, and the changelog entries generated
   from the commit messages.
2. Merging the release PR bumps each `package.json`, writes each
   `CHANGELOG.md`, tags each released package and creates its GitHub Release.

Nobody edits versions or changelogs by hand. To correct an entry, edit the
release PR's changelog before merging it.

The running versions are visible too, for bug reports. `GET /health` returns
the server's `version`, the server logs it at startup, and the web chat shows
both versions in the health badge's tooltip.

### Maintainer setup (once)

- **Settings → Actions → General:** enable "Allow GitHub Actions to create and
  approve pull requests", or release-please cannot open the release PR.
- **Settings → General → Pull Requests:** allow squash merging only, and use
  the PR title as the default commit message.
- A release PR opened with the default `GITHUB_TOKEN` does not trigger other
  workflows, so CI does not run on it. If branch protection requires CI to
  pass, give release-please a personal access token or a GitHub App token
  instead (the `token` input of the action).
