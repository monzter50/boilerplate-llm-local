import { config, type FamilyName } from "./config.js";
import { DEFAULT_PROMPT_ID, getPrompt, hasPrompt } from "./prompts.js";
import type { ModelInfo } from "@ia-local/contracts";
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
  name: FamilyName;
  /** Thinks before answering: slower, better at math, code and logic. */
  reasoning: boolean;
  supportsSystem: boolean;
  /** Applied only when TEMPERATURE is unset in .env. */
  temperature: number;
};

const FAMILIES: Record<FamilyName, Family> = {
  reasoner: {
    name: "reasoner",
    reasoning: true,
    supportsSystem: true,
    temperature: 0.6,
  },
  "reasoner-legacy": {
    name: "reasoner-legacy",
    reasoning: true,
    supportsSystem: false,
    temperature: 0.6,
  },
  chat: {
    name: "chat",
    reasoning: false,
    supportsSystem: true,
    temperature: 0.7,
  },
};

// "r1" only as a whole token of the id: "deepseek-r1-distill" and
// "deepseek-r1:7b" match, "model-r10" and "hr1" do not.
const R1 = /(?:^|[^a-z0-9])r1(?:[^a-z0-9]|$)/i;

/**
 * Guesses the family from the model id, unless MODEL_FAMILIES names it: a
 * name heuristic is bound to miss some models, and the override is the way
 * out without a code change.
 */
export function familyOf(
  model: string,
  overrides: Record<string, FamilyName> = config.modelFamilies,
): Family {
  const override = overrides[model];
  if (override) return FAMILIES[override];

  if (/r1-0528|qwq/i.test(model)) return FAMILIES.reasoner;
  if (R1.test(model) || /reasoner|thinking/i.test(model)) {
    return FAMILIES["reasoner-legacy"];
  }
  return FAMILIES.chat;
}

/** What clients are told about a model, so they can label it. */
export type { ModelInfo };

export function describeModel(id: string): ModelInfo {
  const { name, reasoning, supportsSystem } = familyOf(id);
  return { id, family: name, reasoning, supportsSystem };
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
 *
 * A trimmed conversation never starts with the assistant: chat templates such
 * as Llama's and Mistral's require user/assistant alternation from a user turn,
 * and fail or degrade without it. An untrimmed one is passed through as sent.
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
  while (kept.length > 1 && kept[0]!.role === "assistant") {
    kept.shift();
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

  // The system prompt shares the context window with the history, so it comes
  // out of the same budget. A long prompts/*.md would otherwise push the total
  // past the model's real context.
  const turns = trimHistory(
    provided,
    Math.max(0, config.historyBudget - system.length),
  );
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
