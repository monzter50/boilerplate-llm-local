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
  port: num(process.env.PORT, 3000),
} as const;
