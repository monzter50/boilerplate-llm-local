<!--
The PR title must be a Conventional Commit, e.g. `feat(sdk): add retry option`.
PRs are squash-merged, so the title becomes the commit on main that
release-please turns into the version bump and changelog entry.
-->

## What and why

<!-- What changes for users or contributors, and the reason for it. Link the issue: Closes #123 -->

## Packages touched

<!-- Tick every package whose files change: each one gets its own version and changelog. -->

- [ ] server (`src/`, `prompts/`)
- [ ] `@ia-local/contracts` (`packages/contracts/`)
- [ ] `@ia-local/sdk` (`sdk/`)
- [ ] web (`web/`)

## How it was tested

<!-- Commands run, new tests, and anything checked by hand (e.g. against LM Studio). -->

## Breaking changes

<!-- None, or what breaks and how to migrate. A breaking change also needs `!` in the title: `feat(contracts)!: …` -->

None.

## Checklist

- [ ] Title is a Conventional Commit (`type(scope): summary`)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass
- [ ] New behavior has tests; reusable helpers are in `test/utils/`
- [ ] README / CONTRIBUTING updated if behavior or setup changed
