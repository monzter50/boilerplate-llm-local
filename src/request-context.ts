import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

/** Short enough to stay readable in a log line, long enough not to collide. */
export function newRequestId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Runs `fn` with a request id attached to the async context, so the logger can
 * tag every line a request produces without it being threaded through each
 * call. Callbacks registered inside `fn` — `res.on("finish")`, for one — keep
 * the context.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Re-enters the current request context when the callback eventually runs. A
 * plain event listener runs in the context of whoever emitted the event, not
 * the one it was registered in — so a "close" fired by a socket teardown, or a
 * "finish" fired by the shutdown handler, would otherwise lose the id.
 */
export function bindRequestContext<A extends unknown[]>(
  fn: (...args: A) => void,
): (...args: A) => void {
  const requestId = currentRequestId();
  if (!requestId) return fn;

  return (...args: A) => runWithRequestId(requestId, () => fn(...args));
}
