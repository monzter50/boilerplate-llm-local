import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace packages (contracts) resolve to their TypeScript source, as with
  // `tsx --conditions=source` in dev, so tests never need a build first.
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "sdk/src/**/*.test.ts",
      "packages/git-assist/src/**/*.test.ts",
      ".claude/hooks/**/*.test.mjs",
      // Plain-TS web modules only: no DOM, no "@/" alias.
      "web/src/lib/**/*.test.ts",
    ],
    // config.ts imports "dotenv/config", and dotenv does not overwrite values
    // that are already set — so setting them here makes the suite hermetic
    // whatever each developer happens to have in .env. Blank means "unset",
    // which is what exercises the built-in defaults.
    env: {
      LOG_LEVEL: "silent",
      MODEL: "",
      TEMPERATURE: "",
      MAX_TOKENS: "",
      HISTORY_BUDGET: "",
      SYSTEM_PROMPT: "",
      REQUEST_TIMEOUT_MS: "",
      MAX_RETRIES: "",
      // The suite must pass with LM Studio closed: nothing may reach it.
      LMSTUDIO_BASE_URL: "http://127.0.0.1:1/v1",
    },
  },
});
