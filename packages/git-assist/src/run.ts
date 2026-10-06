import { execFile, spawn } from "node:child_process";
import readline from "node:readline/promises";
import { promisify } from "node:util";
import type { CheckDef } from "./config.js";
import type { CheckResult } from "./conventional.js";

const execFileAsync = promisify(execFile);

/** Runs git and returns stdout. Arguments are never passed through a shell. */
export async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Runs a command attached to this terminal, so hooks print their own output
 * and an editor can open. Resolves with the exit code.
 */
export function runAttached(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * The test runner's own count, worth quoting in a PR: vitest and jest print
 * "Tests  78 passed (78)" or "Tests  1 failed | 77 passed (78)". The last
 * match is the result; npm echoes the script's command line first, and that
 * line can contain the same words.
 */
export function testSummary(output: string): string {
  const matches = output.match(/Tests:?\s+[^\n]*?\(\d+\)/g);
  return matches?.at(-1)?.replace(/\s+/g, " ") ?? "";
}

/** Runs one of the repo's checks from its root and summarizes it in a line. */
export async function runCheck(
  check: CheckDef,
  cwd: string,
): Promise<CheckResult> {
  const { name } = check;
  const [command = "", ...args] = check.command;
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      // npm, pnpm and yarn are .cmd shims on Windows.
      shell: process.platform === "win32",
    });
    return { name, ok: true, detail: testSummary(stdout) };
  } catch (error) {
    const output = String(
      (error as { stdout?: string }).stdout ?? (error as Error).message,
    );
    const lastLine = output.trim().split("\n").filter(Boolean).at(-1) ?? "";
    return { name, ok: false, detail: `failed: ${lastLine.slice(0, 160)}` };
  }
}

/**
 * Asks a question in the terminal. Returns null when there is no terminal to
 * ask in (a pipe, CI, an agent): then nothing is confirmed, and the caller
 * must not act unless --yes was given.
 */
export async function ask(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await rl.question(question)).trim().toLowerCase();
  } finally {
    rl.close();
  }
}

/**
 * The URL of the open PR for `branch`: "" when there is none, null when gh
 * itself cannot run (not installed, not logged in).
 */
export function existingPr(branch: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      [
        "pr",
        "view",
        branch,
        "--json",
        "url,state",
        "-q",
        'select(.state == "OPEN") | .url',
      ],
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout.trim());
        if (/no pull requests found/i.test(stderr)) return resolve("");
        resolve(null);
      },
    );
  });
}
