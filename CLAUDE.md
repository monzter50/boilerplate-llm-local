# CLAUDE.md

Guidance for Claude Code in this repo. [CONTRIBUTING.md](CONTRIBUTING.md) is
the full reference for humans; this file is the part that matters when writing
code and commits here.

## Commits follow the repo's husky + commitlint rules

Every commit message and PR title must be a Conventional Commit. release-please
turns them into versions and changelogs, so a malformed one silently drops out
of the release.

```
<type>(<optional scope>): <summary>
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
  `chore`, `revert`. Nothing else (`setup:`, `update:`, `wip:` are rejected).
- **Scopes (optional):** `server`, `sdk`, `contracts`, `web`, `deps`,
  `release`. Use the package the change touches; omit the scope when it spans
  several.
- **Breaking change:** `!` after the type (`feat(contracts)!: …`) or a
  `BREAKING CHANGE:` footer.
- **Pick the type by effect on users:** `feat` adds behavior (minor bump),
  `fix` corrects it (patch), `refactor`/`perf`/`docs` are patch, and
  `test`/`build`/`ci`/`chore` are hidden from the changelog and bump nothing.
- **Summary:** imperative, no trailing period, header under 100 characters.
  Wrap body lines at 100.
- PR titles use the same format. PRs are squash-merged, so the title becomes the
  commit on `main`.

## Never bypass the git hooks

The hooks are `pre-commit` (ESLint + Prettier on staged files),
`commit-msg` (commitlint) and `pre-push` (typecheck + tests).

- Do not use `--no-verify`, `git commit -n`, `HUSKY=0`, or a changed
  `core.hooksPath`. A Claude Code hook (`.claude/hooks/guard-git-hooks.mjs`)
  blocks them.
- When a hook fails, fix the cause: reformat, fix the lint error, reword the
  message, make the test pass. Then commit again.
- If the user explicitly wants to skip the hooks, tell them to run the command
  themselves.

## Creating a pull request

When the user asks for a PR:

1. Never commit to `main`. Branch from an up-to-date `main` as
   `<type>/<short-topic>` (`feat/sdk-retry`, `fix/stream-slot-release`).
2. Run the checks below before pushing. The pre-push hook runs typecheck and
   tests anyway, but a failure is cheaper to see first.
3. Push with `git push -u origin <branch>`. Pushing is outward-facing, so make
   sure the user asked for it.
4. Open the PR with `gh pr create --base main --title "<type>(<scope>): <summary>"`
   and a `--body` that fills in every section of
   `.github/pull_request_template.md`:
   - **What and why**, linking the issue if there is one.
   - **Packages touched**, with the boxes ticked from the paths changed.
   - **How it was tested**: the commands run and their real results. Say if
     something was not tested.
   - **Breaking changes**: say "None." when there are none, and add `!` to the
     title when there are.
   - The checklist, ticked only for what is actually true.
5. Use one PR per change. Use `--draft` when the user says it isn't ready.
6. Do not merge PRs, force-push a branch under review, or edit the release PR,
   unless the user asks.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

Tests pass with LM Studio closed. Reusable test helpers go in `test/utils/`, not
inline in a test file. `CHANGELOG.md` files are written by release-please:
never edit them by hand.
