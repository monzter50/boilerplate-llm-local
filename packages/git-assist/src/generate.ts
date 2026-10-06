import type { Ask, Turn } from "./model.js";

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
  const turns: Turn[] = [{ role: "user", content: options.prompt }];
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
