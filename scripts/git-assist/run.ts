import { execFile, spawn } from "node:child_process";
import readline from "node:readline/promises";
import { promisify } from "node:util";
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

/** Runs one of the repo checks and summarizes the result in a line. */
export async function runCheck(
  name: string,
  args: string[],
): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("pnpm", args, {
      maxBuffer: 64 * 1024 * 1024,
    });
    // vitest prints "Tests  78 passed (78)"; worth quoting in the PR.
    const tests = /Tests\s+\d+ passed[^\n]*/.exec(stdout)?.[0];
    return { name, ok: true, detail: tests?.replace(/\s+/g, " ") ?? "" };
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
