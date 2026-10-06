import OpenAI from "openai";
import type { Settings } from "./config.js";

export type Turn = { role: "user" | "assistant"; content: string };

/** Sends a conversation to a model and returns its answer text. */
export type Ask = (turns: Turn[]) => Promise<string>;

/**
 * The answer without the chain of thought. Servers that do not parse
 * reasoning into its own field leave it inline as <think>...</think>, and some
 * chat templates inject the opening tag, so only "</think>" shows up.
 */
export function stripThinking(content: string): string {
  const close = content.lastIndexOf("</think>");
  const answer =
    close === -1 ? content : content.slice(close + "</think>".length);
  return answer.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * The first loaded model that can chat. LM Studio lists embedding models too,
 * and asking one of those for a commit message fails in a confusing way.
 */
export function pickChatModel(ids: string[]): string | undefined {
  return ids.find((id) => !/embed/i.test(id));
}

/** Turns a client failure into what the person can do about it. */
export function explain(
  error: unknown,
  settings: Pick<Settings, "baseUrl" | "timeoutMs">,
  model: string,
): string {
  const name = (error as Error).name ?? "";
  if (/Timeout/i.test(name)) {
    return (
      `${model} did not answer within ${settings.timeoutMs / 1000}s. Try a ` +
      "smaller diff (commit in smaller steps, or lower GIT_ASSIST_DIFF_CHARS), " +
      "a faster model (GIT_ASSIST_MODEL), or a longer GIT_ASSIST_TIMEOUT_MS."
    );
  }
  if (/Connection/i.test(name)) {
    return (
      `Cannot reach a model server at ${settings.baseUrl}. Open LM Studio, ` +
      "load a model and start the server (Developer tab), or set GIT_ASSIST_BASE_URL."
    );
  }
  return (error as Error).message;
}

/**
 * An Ask backed by an OpenAI-compatible server: LM Studio by default, but
 * Ollama or llama.cpp work the same through GIT_ASSIST_BASE_URL.
 */
export async function connect(
  settings: Settings,
  system: string,
): Promise<{ ask: Ask; model: string }> {
  const client = new OpenAI({
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
    timeout: settings.timeoutMs,
    maxRetries: 0,
  });

  let model = settings.model;
  if (!model) {
    let ids: string[];
    try {
      ids = (await client.models.list()).data.map((m) => m.id);
    } catch (error) {
      throw new Error(explain(error, settings, "the model server"), {
        cause: error,
      });
    }
    model = pickChatModel(ids);
    if (!model) {
      throw new Error(
        `No chat model is loaded at ${settings.baseUrl}. Load one in LM Studio, or set GIT_ASSIST_MODEL.`,
      );
    }
  }
  const chosen = model;

  const ask: Ask = async (turns) => {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: chosen,
        messages: [{ role: "system", content: system }, ...turns],
        // Low, for output that follows the format rather than varies.
        temperature: 0.3,
        max_tokens: settings.maxTokens,
      });
    } catch (error) {
      throw new Error(explain(error, settings, chosen), { cause: error });
    }

    const choice = completion.choices[0];
    const answer = stripThinking(choice?.message?.content ?? "");
    if (!answer && choice?.finish_reason === "length") {
      throw new Error(
        `${chosen} spent its whole token budget (${settings.maxTokens}) thinking ` +
          "and wrote no answer. Raise GIT_ASSIST_MAX_TOKENS, or set " +
          "GIT_ASSIST_MODEL to a non-reasoning model.",
      );
    }
    return answer;
  };

  return { ask, model: chosen };
}
