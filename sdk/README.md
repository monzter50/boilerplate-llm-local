# @ia-local/sdk

A typed client for the IA-local HTTP API. It has no runtime dependencies: it
uses `fetch`, so it works in browsers and in Node 22+. Its types come from
[`@ia-local/contracts`](../packages/contracts/README.md), the same schemas the
server validates with.

```ts
import { ApiError, createClient } from "@ia-local/sdk";

const api = createClient({ baseUrl: "http://localhost:3000" });

const { answer } = await api.chat({
  message: "Explain embeddings in one line",
});
```

## Creating a client

```ts
createClient({
  baseUrl?: string,     // default http://localhost:3000; a trailing slash is fine
  fetch?: typeof fetch, // for tests, or a runtime without a global fetch
});
```

In the browser, point it at a same-origin path and let the dev server proxy it,
as the web chat does: `createClient({ baseUrl: "/api" })`.

## Methods

| Method                          | Endpoint               | Returns                                                                                          |
| ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `health()`                      | `GET /health`          | `{ status: "ok", version, model, info, baseURL }` or `{ status: "unavailable", version, error }` |
| `models()`                      | `GET /models`          | ids of the models loaded in LM Studio                                                            |
| `modelDetails()`                | `GET /models`          | `ModelInfo[]`: each model with its family and `reasoning` flag                                   |
| `refreshModel()`                | `POST /models/refresh` | the active model id, after swapping it in LM Studio                                              |
| `prompts()`                     | `GET /prompts`         | ids of the system prompts in the server's `prompts/`                                             |
| `chat(request)`                 | `POST /chat`           | `{ answer, reasoning?, finishReason, truncated, modelInfo }`                                     |
| `chatStream(request, options?)` | `POST /chat/stream`    | an async generator of `{ kind: "reasoning" \| "content", text }`                                 |

Every method takes `{ signal }` to cancel it.

`health()` returns "unavailable" on a 503 instead of throwing, because it is an
answer about LM Studio, not a failure of the request.

### The request

```ts
type ChatRequest = {
  message?: string; // single turn…
  messages?: ChatMessage[]; // …or the whole history: the server is stateless
  promptId?: string; // a file in the server's prompts/, see prompts()
  system?: string; // raw system prompt; wins over promptId
  temperature?: number; // 0–2
  maxTokens?: number;
  model?: string; // a loaded model; default is the server's
};
```

Send `message` or `messages`. Nothing is kept on the server between requests,
so multi-turn chat means sending the history every time.

## Streaming

```ts
const controller = new AbortController();

for await (const chunk of api.chatStream(
  { messages, promptId: "coder" },
  {
    signal: controller.signal,
    onMeta: (info) => console.log("answering:", info.id, info.reasoning),
  },
)) {
  if (chunk.kind === "content") process.stdout.write(chunk.text);
  // chunk.kind === "reasoning": the model's chain of thought; skip it if you
  // only want the answer.
}
```

- `onMeta` runs once, before the first chunk, with the model that is answering.
- The generator returns when the server sends `done`.
- `controller.abort()` rejects with an `AbortError`, and the server stops
  generating, so LM Studio does not keep working for nobody.

## Errors

Every failure is an `ApiError`:

```ts
try {
  await api.chat({ message: "hi", promptId: "nope" });
} catch (error) {
  if (error instanceof ApiError) {
    error.status; // 400
    error.message; // "Unknown prompt 'nope'. Available: coder, default, translator"
    error.requestId; // on 500s: matches the server's log line
    error.body; // the raw response body
  }
}
```

| Status | When                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| 400    | the request failed validation; the message lists each problem                               |
| 429    | another generation is running and the server allows only one (`MAX_CONCURRENT_GENERATIONS`) |
| 500    | the model or LM Studio failed, before or during the stream                                  |
| 502    | the stream ended without `done`: the connection dropped                                     |
| 503    | the server shut down mid-stream, or (`models()`, `refreshModel()`) LM Studio is unreachable |

## Types

The SDK re-exports these types from the contract: `ChatMessage`, `ChatChunk`,
`ChatRequest`, `ChatResponse`, `ErrorResponse`, `HealthResponse`, `ModelInfo`
and `ValidationIssue`. It also exports `parseSse`, its Server-Sent Events
parser, for anyone reading the stream by hand.

## Development

```bash
pnpm --filter @ia-local/sdk typecheck
pnpm test                     # sdk/src/client.test.ts runs against the real server routes
pnpm --filter @ia-local/sdk build   # emit dist/, the target of publishConfig
```

The tests mount the real Express app with a fake LLM. They cover the SDK
against the server's actual routes and SSE framing, with no LM Studio needed.
Commits that touch this package release under the `sdk` scope.
