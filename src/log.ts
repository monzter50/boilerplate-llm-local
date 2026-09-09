import { createLogger, LogLevel } from "@aglaya/logger";
import { config, type LogLevel as ConfigLogLevel } from "./config.js";
import { currentRequestId } from "./request-context.js";

const LEVELS: Record<ConfigLogLevel, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
  silent: LogLevel.SILENT,
};

const base = createLogger({
  level: LEVELS[config.logLevel],
  timestamps: true,
  // ANSI codes only when writing to a terminal: piping to a file or to a log
  // collector should get plain text.
  colors: process.stdout.isTTY === true,
});

/**
 * Tags the line with the current request id, so every line a single request
 * produced can be correlated — including the ones logged deep inside a route
 * handler, which never see the id themselves.
 */
function tag(message: string): string {
  const requestId = currentRequestId();
  return requestId ? `[${requestId}] ${message}` : message;
}

export const log = {
  debug: (message: string, data?: unknown) => base.debug(tag(message), data),
  info: (message: string, data?: unknown) => base.info(tag(message), data),
  warn: (message: string, data?: unknown) => base.warn(tag(message), data),
  error: (message: string, data?: unknown) => base.error(tag(message), data),
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

/**
 * A client that hangs up mid-generation aborts the upstream request, and the
 * SDK reports that as an error. It is the expected outcome of a cancellation,
 * not a failure, so it must not be logged as one.
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "APIUserAbortError")
  );
}
