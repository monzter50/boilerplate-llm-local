import OpenAI from "openai";
import { config } from "./config.js";
import { familyOf, resolveParams } from "./harness.js";
import { splitThinking, ThinkSplitter } from "./think.js";

export { splitThinking } from "./think.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * LM Studio exposes an OpenAI-compatible API, so we reuse the OpenAI SDK
 * pointed at the local server. The API key is a placeholder: it is not checked.
 */
export const client = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey,
  // The SDK defaults to 10 minutes and 2 retries, so a hung LM Studio would
  // hold a request open far longer than anyone waits for a local model.
  timeout: config.requestTimeoutMs,
  maxRetries: config.maxRetries,
});

let resolvedModel: string | null = config.model || null;

/** Lists the models loaded in LM Studio. Throws if the server is not running. */
export async function listModels(): Promise<string[]> {
  try {
    const res = await client.models.list();
    return res.data.map((m) => m.id);
  } catch (error) {
    throw new Error(
      `Cannot reach LM Studio at ${config.baseURL}. ` +
        `Open LM Studio > Developer, load a model and click "Start Server". ` +
        `(${(error as Error).message})`,
      { cause: error },
    );
  }
}

/** Forces the next getModel() to ask LM Studio again. */
export function clearModelCache(): void {
  resolvedModel = config.model || null;
}

/**
 * Returns the model to use. When MODEL is empty in .env, picks the first model
 * loaded in LM Studio and caches it for the rest of the process. Pass
 * `refresh` after the model has been swapped in LM Studio, so the change does
 * not require restarting.
 */
export async function getModel(
  options: { refresh?: boolean } = {},
): Promise<string> {
  if (options.refresh) clearModelCache();
  if (resolvedModel) return resolvedModel;

  const models = await listModels();
  const first = models[0];
  if (!first) {
    throw new Error(
      "LM Studio is running but no model is loaded. Load a DeepSeek model in the Developer tab.",
    );
  }
  resolvedModel = first;
  return first;
}

export type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /** Aborts the upstream request, so a client hanging up stops generation. */
  signal?: AbortSignal;
};

export type ChatResult = {
  content: string;
  /** Chain of thought, for reasoning models such as DeepSeek R1. */
  reasoning: string;
  /** "length" means the model ran out of tokens before finishing. */
  finishReason: string | null;
};

/** Stream event: reasoning tokens and answer tokens arrive interleaved. */
export type ChatChunk = {
  kind: "reasoning" | "content";
  text: string;
};

/**
 * Reasoning models expose their chain of thought in a non-standard field that
 * is missing from the OpenAI SDK types: LM Studio and the DeepSeek API use
 * `reasoning_content`, other servers use `reasoning`. Some GGUF builds instead
 * leave raw <think> tags inside `content`, which think.ts splits out.
 */
type ReasoningPayload = {
  reasoning_content?: string | null;
  reasoning?: string | null;
};

function readReasoning(payload: object | undefined): string {
  const p = payload as ReasoningPayload | undefined;
  return p?.reasoning_content ?? p?.reasoning ?? "";
}

/** Full response, no streaming. */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const model = options.model ?? (await getModel());
  const params = resolveParams(model, options);

  const completion = await client.chat.completions.create(
    {
      model,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: false,
    },
    { signal: options.signal },
  );

  const choice = completion.choices[0];
  const raw = choice?.message?.content ?? "";
  const fielded = readReasoning(choice?.message);

  // Prefer the dedicated field; fall back to inline tags.
  const { thinking, answer } = fielded
    ? { thinking: fielded, answer: raw.trim() }
    : splitThinking(raw, {
        reasoningModel: familyOf(model).reasoning,
        truncated: choice?.finish_reason === "length",
      });

  return {
    content: answer,
    reasoning: thinking,
    finishReason: choice?.finish_reason ?? null,
  };
}

/** Streamed response, yielding reasoning and answer chunks as they arrive. */
export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<ChatChunk> {
  const model = options.model ?? (await getModel());
  const params = resolveParams(model, options);

  const stream = await client.chat.completions.create(
    {
      model,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: true,
    },
    { signal: options.signal },
  );

  // Inline <think> tags only matter when the server does not parse reasoning
  // into its own field. Once that field shows up, content is pure answer.
  const splitter = new ThinkSplitter({
    implicitThinking: familyOf(model).reasoning,
  });
  let fielded = false;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    const reasoning = readReasoning(delta);
    if (reasoning) {
      fielded = true;
      yield { kind: "reasoning", text: reasoning };
    }

    if (delta.content) {
      if (fielded) yield { kind: "content", text: delta.content };
      else yield* splitter.push(delta.content);
    }
  }

  // Flushes a partial tag held back, or reasoning cut off by the token budget.
  // Returns nothing when the splitter never saw any content.
  yield* splitter.end();
}
