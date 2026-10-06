import { describe, expect, it } from "vitest";
import { bypassReason } from "./guard-git-hooks.mjs";

describe("bypassReason", () => {
  it.each([
    'git commit --no-verify -m "feat: x"',
    'git commit -n -m "feat: x"',
    'git commit -nm "feat: x"',
    'git add . && git commit -am "fix: y" --no-verify',
    'HUSKY=0 git commit -m "feat: x"',
    "export HUSKY=0; git push",
    "git push --no-verify origin main",
    'git -c core.hooksPath=/dev/null commit -m "feat: x"',
    "git config core.hooksPath .git/hooks",
    'git -C ../other commit -n -m "x"',
    '/usr/bin/git commit --no-verify -m "x"',
  ])("blocks %s", (command) => {
    expect(bypassReason(command)).not.toBeNull();
  });

  it.each([
    'git commit -m "feat: x"',
    'git commit -m "docs: explain why we never use --no-verify"',
    "git commit -m 'fix: handle -n flag in parser'",
    "git push -n origin main",
    "git push origin main",
    "git status && git log --oneline -5",
    "git commit --amend --no-edit",
    'grep -n "no-verify" CONTRIBUTING.md',
    // The false positive that blocked a real session: "git" inside a path,
    // "commit" in a file name and grep's -n are not a git commit.
    'grep -n "^const" scripts/git-assist/commit.ts scripts/git-assist/pr.ts',
    "cat scripts/git-assist/commit.ts | head -n 5",
    "pnpm commit --dry-run",
    "echo HUSKY=0 is how you turn husky off",
  ])("allows %s", (command) => {
    expect(bypassReason(command)).toBeNull();
  });
});
