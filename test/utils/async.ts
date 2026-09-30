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

/** Resolves after `ms`; stands in for a slow model in stream tests. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
