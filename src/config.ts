import "dotenv/config";

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  baseURL: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
  apiKey: process.env.LMSTUDIO_API_KEY ?? "lm-studio",
  /** Empty = resolved at runtime from the first model loaded in LM Studio. */
  model: process.env.MODEL?.trim() ?? "",
  temperature: num(process.env.TEMPERATURE, 0.7),
  // Reasoning models spend most of the budget on the chain of thought, so this
  // needs headroom that a non-reasoning model would not require.
  maxTokens: num(process.env.MAX_TOKENS, 4096),
  systemPrompt:
    process.env.SYSTEM_PROMPT ??
    "You are a helpful, concise assistant. Answer in the user's language.",
  port: num(process.env.PORT, 3000),
} as const;
