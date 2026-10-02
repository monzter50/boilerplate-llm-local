import { readFileSync } from "node:fs";

/**
 * The server's version, from its package.json, which release-please bumps on
 * every release. "../package.json" resolves to the repo root from both src/
 * (tsx) and dist/ (node), like prompts/ does.
 */
export const version: string = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;
