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
  /** Unset = the harness falls back to prompts/default.md. */
  systemPrompt: optionalStr(process.env.SYSTEM_PROMPT),
  /** Characters of history kept before the oldest turns are dropped. */
  historyBudget: num(process.env.HISTORY_BUDGET, 24000),
  // The OpenAI SDK defaults to a 10-minute timeout and 2 retries, which means a
  // hung LM Studio pins a request for that long. Two minutes is still generous
  // for a local reasoning model, and one retry reports a dead server sooner.
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 120_000),
  maxRetries: num(process.env.MAX_RETRIES, 1),
  logLevel: logLevel(process.env.LOG_LEVEL),
  port: num(process.env.PORT, 3000),
} as const;
