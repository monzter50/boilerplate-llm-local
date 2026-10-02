import "dotenv/config";

/** Undefined when unset or blank, so a caller can apply its own default. */
function optionalNum(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function num(value: string | undefined, fallback: number): number {
  return optionalNum(value) ?? fallback;
}

function optionalStr(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The model families the harness knows; see familyOf in harness.ts. */
export const FAMILY_NAMES = ["reasoner", "reasoner-legacy", "chat"] as const;
export type FamilyName = (typeof FAMILY_NAMES)[number];

/**
 * Parses MODEL_FAMILIES, e.g. "qwen/qwen3.5-9b=reasoner, my-model=chat", for
 * models the name heuristic gets wrong. Per model rather than one global
 * value: the web UI can send any loaded model, and a single override would
 * mislabel the rest. Throws on a typo, so it fails at startup rather than
 * being silently ignored.
 */
export function parseModelFamilies(
  value: string | undefined,
): Record<string, FamilyName> {
  const families: Record<string, FamilyName> = {};
  for (const entry of (value ?? "").split(",")) {
    if (!entry.trim()) continue;
    const separator = entry.lastIndexOf("=");
    const id = entry.slice(0, separator).trim();
    const family = entry.slice(separator + 1).trim();
    if (separator === -1 || !id) {
      throw new Error(
        `MODEL_FAMILIES: expected "model-id=family", got "${entry.trim()}".`,
      );
    }
    if (!FAMILY_NAMES.includes(family as FamilyName)) {
      throw new Error(
        `MODEL_FAMILIES: unknown family "${family}" for "${id}". Use one of: ${FAMILY_NAMES.join(", ")}.`,
      );
    }
    families[id] = family as FamilyName;
  }
  return families;
}

function logLevel(value: string | undefined): LogLevel {
  const level = value?.trim().toLowerCase();
  return LOG_LEVELS.includes(level as LogLevel) ? (level as LogLevel) : "info";
}

export const config = {
  baseURL: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
  apiKey: process.env.LMSTUDIO_API_KEY ?? "lm-studio",
  /** Empty = resolved at runtime from the first model loaded in LM Studio. */
  model: process.env.MODEL?.trim() ?? "",
  /** Unset = the harness uses the temperature the model family wants. */
  temperature: optionalNum(process.env.TEMPERATURE),
  // Reasoning models spend most of the budget on the chain of thought, so this
  // needs headroom that a non-reasoning model would not require.
  maxTokens: num(process.env.MAX_TOKENS, 4096),
  /** Per-model family overrides, for when the name heuristic is wrong. */
  modelFamilies: parseModelFamilies(process.env.MODEL_FAMILIES),
  /** Unset = the harness falls back to prompts/default.md. */
  systemPrompt: optionalStr(process.env.SYSTEM_PROMPT),
  /** Characters of history kept before the oldest turns are dropped. */
  historyBudget: num(process.env.HISTORY_BUDGET, 24000),
  // The OpenAI SDK defaults to a 10-minute timeout and 2 retries, which means a
  // hung LM Studio pins a request for that long. Two minutes is still generous
  // for a local reasoning model, and one retry reports a dead server sooner.
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 120_000),
  maxRetries: num(process.env.MAX_RETRIES, 1),
  // LM Studio serves one generation at a time by default; extra requests wait
  // in its queue and surface as mysterious timeouts. 0 = no limit.
  maxConcurrentGenerations: num(process.env.MAX_CONCURRENT_GENERATIONS, 1),
  logLevel: logLevel(process.env.LOG_LEVEL),
  port: num(process.env.PORT, 3000),
} as const;

export type Config = typeof config;
