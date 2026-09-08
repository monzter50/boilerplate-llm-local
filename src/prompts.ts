import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prompts live as .md files under prompts/ at the repo root, so they can be
 * diffed and reviewed like any other source. rootDir is "src" and outDir is
 * "dist", both flat, so "../prompts" resolves to the repo root whether this
 * module runs from src/ (tsx) or dist/ (node).
 */
const dir = fileURLToPath(new URL("../prompts", import.meta.url));

/** Used when no prompt is selected and SYSTEM_PROMPT is unset. */
export const DEFAULT_PROMPT_ID = "default";

function load(): Map<string, string> {
  try {
    return new Map(
      readdirSync(dir)
        .filter((file) => extname(file) === ".md")
        .sort()
        .map(
          (file) =>
            [
              basename(file, ".md"),
              readFileSync(join(dir, file), "utf8").trim(),
            ] as const,
        ),
    );
  } catch {
    // A missing prompts/ directory is not fatal: SYSTEM_PROMPT and the
    // built-in fallback still work.
    return new Map();
  }
}

// Read once at boot: prompts are static assets, not runtime data.
const registry = load();

export function listPrompts(): string[] {
  return [...registry.keys()];
}

export function hasPrompt(id: string): boolean {
  return registry.has(id);
}

export function getPrompt(id: string): string {
  const prompt = registry.get(id);
  if (prompt === undefined) {
    const available = registry.size
      ? `Available: ${listPrompts().join(", ")}.`
      : "No prompts/*.md files were found.";
    throw new Error(`Unknown prompt '${id}'. ${available}`);
  }
  return prompt;
}
