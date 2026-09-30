/** One Server-Sent Events frame. `event` is "message" when the frame names none. */
export type SseEvent = {
  event: string;
  data: string;
};

/**
 * Parses a Server-Sent Events body into frames, following the parts of the
 * spec the API uses: `event:` and `data:` fields, comments, and frames split
 * across network chunks. EventSource cannot be used instead because it only
 * does GET, and /chat/stream is a POST.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      // stream: true holds back a multi-byte character split across chunks.
      buffer += decoder.decode(value, { stream: true });

      // Keep the trailing partial line in the buffer until more text arrives.
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          // A blank line dispatches the frame; one without data is ignored.
          if (data.length > 0) {
            yield { event: event || "message", data: data.join("\n") };
          }
          event = "";
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue;

        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);

        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
    }
  } finally {
    // A consumer that stops iterating early (a `break`) would otherwise leave
    // the connection open, and the server generating for nobody. A no-op when
    // the body was read to the end.
    await reader.cancel().catch(() => {});
  }
}
