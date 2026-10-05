import { buildMessages } from "../../src/harness.js";
import { chat, getModel, type ChatMessage } from "../../src/llm.js";

/** Sends a conversation to a model and returns its answer text. */
export type Ask = (turns: ChatMessage[]) => Promise<string>;

/**
 * An Ask backed by the local model, through the same harness as the API and
 * the CLI, so family quirks (no system role for the original R1, temperature)
 * apply here too. GIT_ASSIST_MODEL picks a different loaded model, e.g. a
 * faster non-reasoning one.
 */
export async function localModel(system: string): Promise<{
  ask: Ask;
  model: string;
}> {
  const model = process.env.GIT_ASSIST_MODEL?.trim() || (await getModel());
  // A whole branch's diff can take a reasoning model longer than the API's
  // 2-minute limit, and nobody is waiting on a chat bubble here.
  const timeout = Number(process.env.GIT_ASSIST_TIMEOUT_MS) || 300_000;
  const ask: Ask = async (turns) => {
    let result;
    try {
      result = await chat(buildMessages({ system, messages: turns, model }), {
        model,
        timeout,
      });
    } catch (error) {
      throw new Error(explain(error, model, timeout), { cause: error });
    }
    if (!result.content && result.finishReason === "length") {
      throw new Error(
        `${model} spent its whole token budget thinking and wrote no answer. ` +
          "Raise MAX_TOKENS in .env, or set GIT_ASSIST_MODEL to a non-reasoning model.",
      );
    }
    return result.content;
  };
  return { ask, model };
}

export type Attempt<T> = {
  value: T;
  valid: boolean;
  errors: string[];
};

/**
 * Asks, validates, and on failure sends the validator's errors back for
 * another try. Small models fix a named mistake far more reliably than they
 * avoid it up front. Returns the last attempt even when invalid, so the caller
 * can show it and let the person decide.
 */
export async function generateValid<T>(options: {
  prompt: string;
  ask: Ask;
  parse: (answer: string) => T;
  validate: (value: T) => Promise<{ valid: boolean; errors: string[] }>;
  /** The text of the value to quote back when asking for a fix. */
  show: (value: T) => string;
  maxAttempts?: number;
  onAttempt?: (n: number, attempt: Attempt<T>) => void;
}): Promise<Attempt<T> & { attempts: number }> {
  const maxAttempts = options.maxAttempts ?? 3;
  const turns: ChatMessage[] = [{ role: "user", content: options.prompt }];
  let last: Attempt<T> | undefined;

  for (let n = 1; n <= maxAttempts; n++) {
    const answer = await options.ask(turns);
    const value = options.parse(answer);
    const { valid, errors } = await options.validate(value);
    last = { value, valid, errors };
    options.onAttempt?.(n, last);
    if (valid) return { ...last, attempts: n };

    turns.push(
      { role: "assistant", content: answer },
      {
        role: "user",
        content:
          `This fails the repository's commit rules:\n` +
          `${errors.map((e) => `- ${e}`).join("\n")}\n\n` +
          `It was:\n${options.show(value)}\n\n` +
          "Write it again, fixing exactly those problems, in the same output format.",
      },
    );
  }

  return { ...last!, attempts: maxAttempts };
}

/** Turns an SDK failure into what the person can do about it. */
function explain(error: unknown, model: string, timeout: number): string {
  const name = (error as Error).name ?? "";
  if (/Timeout/i.test(name)) {
    return (
      `${model} did not answer within ${timeout / 1000}s. Try a smaller diff ` +
      "(commit in smaller steps, or lower GIT_ASSIST_DIFF_CHARS), a faster " +
      "model (GIT_ASSIST_MODEL), or a longer GIT_ASSIST_TIMEOUT_MS."
    );
  }
  if (/Connection/i.test(name)) {
    return "Cannot reach LM Studio. Open it, load a model and start the server (Developer tab).";
  }
  return (error as Error).message;
}
