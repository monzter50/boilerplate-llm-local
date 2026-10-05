#!/usr/bin/env node
// PreToolUse hook for Bash: stops Claude Code from skipping the repo's husky
// hooks (lint-staged, commitlint, pre-push typecheck and tests). When a hook
// fails, the fix belongs in the code or the commit message, not in a bypass.
//
// Blocks, only where git is the command being run:
//   git commit --no-verify / -n (also inside flag clusters such as -nm)
//   git push --no-verify
//   HUSKY=0 (the husky off switch), as an env prefix or an export
//   git -c core.hooksPath=... and git config core.hooksPath

import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

// git options that take the next word as their value: `git -C dir commit`.
const GIT_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
]);

/** The reason to block `command`, or null when it does not bypass the hooks. */
export function bypassReason(command) {
  // Quoted text is data (a commit message that mentions --no-verify), not flags.
  const code = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");

  // One shell command at a time, so a flag is tied to the git call it belongs to.
  for (const segment of code.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);

    if (words[0] === "export" && words.includes("HUSKY=0")) {
      return "HUSKY=0 turns the husky hooks off";
    }

    // Leading VAR=value assignments, then the command itself.
    let i = 0;
    const env = [];
    while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) {
      env.push(words[i++]);
    }
    if (!/(^|\/)git$/.test(words[i] ?? "")) continue;

    if (env.includes("HUSKY=0")) return "HUSKY=0 turns the husky hooks off";

    const args = words.slice(i + 1);
    if (args.some((w) => w.includes("core.hooksPath"))) {
      return "changing core.hooksPath points git away from the husky hooks";
    }

    // The subcommand is the first word that is not a global option or its value.
    let j = 0;
    while (j < args.length && args[j].startsWith("-")) {
      j += GIT_OPTIONS_WITH_VALUE.has(args[j]) ? 2 : 1;
    }
    const subcommand = args[j];
    const flags = args.slice(j + 1);

    if (subcommand === "commit") {
      if (flags.includes("--no-verify")) {
        return "git commit --no-verify skips the hooks";
      }
      // -n is --no-verify for commit, alone or in a cluster such as -nm.
      if (flags.some((f) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(f))) {
        return "git commit -n is --no-verify, which skips the hooks";
      }
    }
    // For push, -n is --dry-run, so only the long flag counts.
    if (subcommand === "push" && flags.includes("--no-verify")) {
      return "git push --no-verify skips the pre-push checks";
    }
  }
  return null;
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const reason = bypassReason(input?.tool_input?.command ?? "");
  if (!reason) return;

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

// Run as a hook; stay quiet when imported by the tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
