#!/usr/bin/env node
// PreToolUse hook for Bash: stops Claude Code from skipping the repo's husky
// hooks (lint-staged, commitlint, pre-push typecheck and tests). When a hook
// fails, the fix belongs in the code or the commit message, not in a bypass.
//
// Blocks:
//   git commit --no-verify / -n (also inside flag clusters such as -nm)
//   git push --no-verify
//   HUSKY=0 (the husky off switch)
//   git -c core.hooksPath=... and git config core.hooksPath (pointing git elsewhere)

import { readFileSync } from "node:fs";
import process from "node:process";

const input = JSON.parse(readFileSync(0, "utf8"));
const command = input?.tool_input?.command ?? "";

// Quoted text is data (a commit message that mentions --no-verify), not flags.
const code = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");

// One shell command at a time, so a flag is tied to the git call it belongs to.
const segments = code.split(/&&|\|\||[;|\n]/);

function bypass() {
  if (/(^|[\s;&|])HUSKY=0\b/.test(code)) {
    return "HUSKY=0 turns the husky hooks off";
  }
  for (const segment of segments) {
    if (!/\bgit\b/.test(segment)) continue;
    if (/\bcore\.hooksPath\b/.test(segment)) {
      return "changing core.hooksPath points git away from the husky hooks";
    }
    if (/\bcommit\b/.test(segment)) {
      if (/(^|\s)--no-verify\b/.test(segment)) {
        return "git commit --no-verify skips the hooks";
      }
      // -n is --no-verify for commit, alone or in a cluster such as -nm.
      if (/(^|\s)-[a-zA-Z]*n[a-zA-Z]*(\s|$)/.test(segment)) {
        return "git commit -n is --no-verify, which skips the hooks";
      }
    }
    // For push, -n is --dry-run, so only the long flag counts.
    if (/\bpush\b/.test(segment) && /(^|\s)--no-verify\b/.test(segment)) {
      return "git push --no-verify skips the pre-push checks";
    }
  }
  return null;
}

const reason = bypass();
if (reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Blocked: ${reason}. This repo's hooks enforce Conventional Commits ` +
          "(commitlint), formatting and lint (lint-staged), and typecheck + tests " +
          "on push. Fix what the hook reports and run the command again without " +
          "the bypass. If the user explicitly wants to skip the hooks, they can " +
          "run the command themselves.",
      },
    }),
  );
}
