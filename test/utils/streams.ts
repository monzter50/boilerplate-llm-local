/** A byte stream that emits each part as its own chunk, then closes. */
export function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

/** Drains an async iterable (a generator, a stream parser) into an array. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

/**
 * Every way to cut `text` in two, for checking that a parser copes with a token
 * split at any position across network chunks.
 */
export function everyCut(text: string): [string, string][] {
  const cuts: [string, string][] = [];
  for (let i = 1; i < text.length; i++) {
    cuts.push([text.slice(0, i), text.slice(i)]);
  }
  return cuts;
}
