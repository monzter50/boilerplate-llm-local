import { config } from "./config.js";
import { DEFAULT_PROMPT_ID, getPrompt, hasPrompt } from "./prompts.js";
import type { ChatMessage } from "./llm.js";

/** Last resort when there is neither SYSTEM_PROMPT nor prompts/default.md. */
const FALLBACK_SYSTEM_PROMPT =
  "You are a helpful, concise assistant. Answer in the user's language.";

/**
 * Per-family quirks. Reasoning models are the reason this exists: they want a
 * lower temperature than a chat model, and the original DeepSeek R1 wanted no
 * system role at all — instructions had to go in the user turn. R1-0528 added
 * system prompt support, so the two generations need different handling.
 */
export type Family = {
  name: string;
  supportsSystem: boolean;
  /** Applied only when TEMPERATURE is unset in .env. */
  temperature: number;
};

export function familyOf(model: string): Family {
  if (/r1-0528|qwq/i.test(model)) {
    return { name: "reasoner", supportsSystem: true, temperature: 0.6 };
  }
  if (/r1|reasoner|thinking/i.test(model)) {
    return { name: "reasoner-legacy", supportsSystem: false, temperature: 0.6 };
  }
  return { name: "chat", supportsSystem: true, temperature: 0.7 };
}

export type PromptSelection = {
  /** Raw system prompt text. Wins over promptId. */
  system?: string;
  /** Id of a prompts/*.md file, without the extension. */
  promptId?: string;
};

/**
 * Precedence: explicit text, then the selected prompt file, then
 * SYSTEM_PROMPT, then prompts/default.md, then the built-in fallback.
 */
export function resolveSystemPrompt(selection: PromptSelection = {}): string {
  if (selection.system) return selection.system;
  if (selection.promptId) return getPrompt(selection.promptId);
  if (config.systemPrompt) return config.systemPrompt;
  if (hasPrompt(DEFAULT_PROMPT_ID)) return getPrompt(DEFAULT_PROMPT_ID);
  return FALLBACK_SYSTEM_PROMPT;
}

/**
 * Drops the oldest turns until the conversation fits the budget. Sizes are
 * measured in characters rather than tokens: an approximation, but it avoids
 * loading a tokenizer for a limit that is itself a heuristic. The final turn is
 * never dropped — it is the one being answered.
 */
export function trimHistory(
  turns: ChatMessage[],
  budget: number = config.historyBudget,
): ChatMessage[] {
  let total = turns.reduce((sum, turn) => sum + turn.content.length, 0);
  if (total <= budget) return turns;

  const kept = [...turns];
  while (kept.length > 1 && total > budget) {
    total -= kept.shift()!.content.length;
  }
  return kept;
}

/**
 * Folds the system prompt into the most recent user turn, for models that take
 * no system role. The last turn is chosen over the first so the instructions
 * stay close to the question being answered.
 */
function foldIntoLastUserTurn(
  system: string,
  turns: ChatMessage[],
): ChatMessage[] {
  const index = turns.findLastIndex((turn) => turn.role === "user");
  if (index === -1) return turns;

  return turns.map((turn, i) =>
    i === index
      ? { role: "user", content: `${system}\n\n${turn.content}` }
      : turn,
  );
}

export type BuildInput = PromptSelection & {
  /** Single-turn shortcut. Ignored when `messages` is given. */
  message?: string;
  /** Full conversation, when the caller keeps the history. */
  messages?: ChatMessage[];
  /** Resolved model id — the family rules depend on it. */
  model: string;
};

/**
 * The single place where a request turns into a message list. Both the HTTP API
 * and the CLI go through here so they cannot drift apart.
 */
export function buildMessages(input: BuildInput): ChatMessage[] {
  const provided: ChatMessage[] = input.messages
    ? [...input.messages]
    : input.message
      ? [{ role: "user", content: input.message }]
      : [];

  if (provided.length === 0) {
    throw new Error("Provide either 'message' or 'messages'.");
  }

  // A system turn sent by the caller wins over every other source: it means the
  // client is managing the prompt itself.
  const callerSystem =
    provided[0]?.role === "system" ? provided.shift()!.content : undefined;
  const system = callerSystem ?? resolveSystemPrompt(input);

  const turns = trimHistory(provided);
  const family = familyOf(input.model);

  return family.supportsSystem
    ? [{ role: "system", content: system }, ...turns]
    : foldIntoLastUserTurn(system, turns);
}

export type GenerationOverrides = {
  temperature?: number;
  maxTokens?: number;
};

export type GenerationParams = {
  temperature: number;
  maxTokens: number;
};

/**
 * Precedence: per-request override, then .env, then the family default. An
 * explicit TEMPERATURE in .env therefore beats the family's preference.
 */
export function resolveParams(
  model: string,
  overrides: GenerationOverrides = {},
): GenerationParams {
  return {
    temperature:
      overrides.temperature ??
      config.temperature ??
      familyOf(model).temperature,
    maxTokens: overrides.maxTokens ?? config.maxTokens,
  };
}
