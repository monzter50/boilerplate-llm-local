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
