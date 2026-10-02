/**
 * A promise plus the function that resolves it, for waiting on a callback
 * such as an abort listener. Not Promise.withResolvers: that is ES2024, above
 * the ES2023 lib these projects compile against.
 */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Never resolves; rejects with an AbortError once `signal` aborts. Stands in
 * for a slow model in fakes, behaving like the real client, which stops as
 * soon as the request is aborted. A fake that ignores the signal would keep
 * the generation (and its concurrency slot) alive after the client left.
 */
export function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () =>
      reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
