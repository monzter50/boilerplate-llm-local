import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { PackageDef } from "./context.js";

/** A check run before drafting a PR, so its result is real, not invented. */
export type CheckDef = { name: string; command: string[] };

/** Optional .git-assist.json at the repo root. Every field is optional. */
export type FileConfig = {
  baseUrl?: string;
  model?: string;
  base?: string;
  diffChars?: number;
  timeoutMs?: number;
  maxTokens?: number;
  /** Overrides release-please-config.json: { "sdk": "sdk", "server": "." }. */
  packages?: Record<string, string>;
  /** Overrides the checks found in package.json. */
  checks?: CheckDef[];
};

export type Settings = {
  root: string;
  baseUrl: string;
  apiKey: string;
  /** Undefined: use the first chat model loaded in LM Studio. */
  model: string | undefined;
  base: string;
  diffChars: number;
  timeoutMs: number;
  maxTokens: number;
  packages: PackageDef[];
  checks: CheckDef[];
  prTemplate: string | null;
};

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/**
 * GIT_ASSIST_* (and LMSTUDIO_BASE_URL) from the repo's .env. Only those keys:
 * the rest of a project's .env is its own business, and its secrets have no
 * reason to reach this process.
 */
export function readDotEnv(root: string): Record<string, string> {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return {};
  const all = parseEnv(readFileSync(file, "utf8"));
  return Object.fromEntries(
    Object.entries(all).filter(
      (entry): entry is [string, string] =>
        (entry[0].startsWith("GIT_ASSIST_") ||
          entry[0] === "LMSTUDIO_BASE_URL") &&
        typeof entry[1] === "string" &&
        entry[1] !== "",
    ),
  );
}

type ReleasePleaseConfig = {
  packages?: Record<
    string,
    { component?: string; "package-name"?: string; "exclude-paths"?: string[] }
  >;
};

/**
 * The packages of a release-please monorepo, named by their component, which
 * is also what this repo uses as the commit scope.
 */
export function packagesFromReleasePlease(
  config: ReleasePleaseConfig | undefined,
): PackageDef[] {
  return Object.entries(config?.packages ?? {}).map(([dir, pkg]) => ({
    name:
      pkg.component ??
      pkg["package-name"]?.replace(/^@[^/]+\//, "") ??
      path.basename(dir === "." ? process.cwd() : dir),
    path: dir === "." ? "." : dir.replace(/\/+$/, ""),
    exclude: pkg["exclude-paths"],
  }));
}

/**
 * The repo's own check scripts, run with its package manager. Only scripts
 * that exist are used, so a repo without "typecheck" simply skips it.
 */
export function checksFromPackageJson(root: string): CheckDef[] {
  const pkg = readJson<{ scripts?: Record<string, string> }>(
    path.join(root, "package.json"),
  );
  const scripts = pkg?.scripts ?? {};

  const has = (file: string) => existsSync(path.join(root, file));
  const run: (script: string) => string[] = has("pnpm-lock.yaml")
    ? (s) => ["pnpm", s]
    : has("yarn.lock")
      ? (s) => ["yarn", s]
      : has("bun.lock") || has("bun.lockb")
        ? (s) => ["bun", "run", s]
        : (s) => ["npm", "run", s];

  return ["typecheck", "lint", "format:check", "test"]
    .filter((script) => script in scripts)
    .map((script) => ({ name: run(script).join(" "), command: run(script) }));
}

const PR_TEMPLATES = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
];

export function findPrTemplate(root: string): string | null {
  const found = PR_TEMPLATES.find((file) => existsSync(path.join(root, file)));
  return found ? readFileSync(path.join(root, found), "utf8") : null;
}

const num = (value: string | number | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Everything git-assist needs to know about the repo it runs in. Precedence:
 * the environment, then the repo's .env, then .git-assist.json, then what the
 * repo already declares (release-please config, package.json scripts, PR
 * template), then defaults that suit LM Studio.
 */
export function loadSettings(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Settings {
  const file = readJson<FileConfig>(path.join(root, ".git-assist.json")) ?? {};
  const dotenv = readDotEnv(root);
  const pick = (key: string) => env[key]?.trim() || dotenv[key];

  const packages = file.packages
    ? Object.entries(file.packages).map(([name, dir]) => ({
        name,
        path: dir === "." ? "." : dir.replace(/\/+$/, ""),
      }))
    : packagesFromReleasePlease(
        readJson<ReleasePleaseConfig>(
          path.join(root, "release-please-config.json"),
        ),
      );

  return {
    root,
    baseUrl:
      pick("GIT_ASSIST_BASE_URL") ??
      pick("LMSTUDIO_BASE_URL") ??
      file.baseUrl ??
      "http://localhost:1234/v1",
    // LM Studio ignores the key, but the OpenAI client requires one.
    apiKey: pick("GIT_ASSIST_API_KEY") ?? "lm-studio",
    model: pick("GIT_ASSIST_MODEL") ?? file.model,
    base: pick("GIT_ASSIST_BASE") ?? file.base ?? "main",
    diffChars:
      num(pick("GIT_ASSIST_DIFF_CHARS")) ?? num(file.diffChars) ?? 6000,
    // A whole branch's diff can take a reasoning model several minutes.
    timeoutMs:
      num(pick("GIT_ASSIST_TIMEOUT_MS")) ?? num(file.timeoutMs) ?? 300_000,
    // Reasoning models spend much of this on thinking before they answer.
    maxTokens:
      num(pick("GIT_ASSIST_MAX_TOKENS")) ?? num(file.maxTokens) ?? 4096,
    packages,
    checks: file.checks ?? checksFromPackageJson(root),
    prTemplate: findPrTemplate(root),
  };
}
