/** The part of a streamed chat completion chunk that llm.ts reads. */
export type FakeDelta = {
  content?: string;
  reasoning_content?: string;
};

/**
 * Stands in for the async iterable `client.chat.completions.create` returns
 * with `stream: true`, so llm.ts can be tested without LM Studio.
 */
export async function* fakeCompletionStream(
  deltas: FakeDelta[],
): AsyncGenerator<{ choices: { delta: FakeDelta }[] }> {
  for (const delta of deltas) yield { choices: [{ delta }] };
}
