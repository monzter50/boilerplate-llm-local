import { inspect } from "node:util";

type Level = "info" | "warn" | "error";

const COLOR: Record<Level, string> = {
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

// Escape codes only when writing to a terminal: piping to a file or to a log
// collector should get plain text.
const color = process.stdout.isTTY === true;

function write(level: Level, message: string, context?: unknown): void {
  const tag = level.toUpperCase().padEnd(5);
  const head = color ? `${COLOR[level]}${tag}${RESET}` : tag;
  const tail =
    context === undefined
      ? ""
      : ` ${inspect(context, { depth: 3, breakLength: Infinity, colors: color })}`;

  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${new Date().toISOString()} ${head} ${message}${tail}\n`);
}

export const log = {
  info: (message: string, context?: unknown) => write("info", message, context),
  warn: (message: string, context?: unknown) => write("warn", message, context),
  error: (message: string, context?: unknown) =>
    write("error", message, context),
};

/**
 * Normalizes anything thrown into something worth printing. Without this a
 * non-Error rejection logs as "[object Object]" and the stack is lost.
 */
export function describeError(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return error.stack
      ? { message: error.message, stack: error.stack }
      : { message: error.message };
  }
  return { message: String(error) };
}
