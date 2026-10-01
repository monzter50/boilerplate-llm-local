# IA-local

Local AI chat backed by **DeepSeek running in LM Studio**. No cloud calls, no API keys.

Two entry points share one LLM client:

- a **terminal chat** with streaming and conversation history
- an **HTTP API** (`/chat`, `/chat/stream`)

And two clients sit on top of the API:

- a **typed SDK** (`sdk/`, `@ia-local/sdk`) for any TypeScript app
- a **web chat** (`web/`, React + shadcn/ui) built on that SDK

## Requirements

- Node.js 22+ and pnpm
- LM Studio with a model loaded and the local server started
  (**Developer** tab → load model → **Start Server**, default `http://localhost:1234`)

## Setup

```bash
pnpm install
cp .env.example .env   # then set MODEL to the id shown in LM Studio
```

`MODEL` may be left empty: the app then picks the first model loaded in LM Studio.

## Usage

```bash
pnpm cli       # terminal chat
pnpm dev       # HTTP API on http://localhost:3000 (watch mode)
pnpm web       # web chat on http://localhost:5173 (needs the API running)
pnpm dev:all   # API and web chat together
```

> `pnpm server` does **not** work: `server` is a built-in pnpm command that
> manages its store server, and it shadows the script of the same name — it
> exits with code 0 without printing anything. Use `pnpm dev`, or
> `pnpm run server`, which forces the script.

CLI commands: `/prompt [id]`, `/model [refresh]`, `/reset`, `/reasoning`,
`/history`, `/help`, `/exit`.

```bash
pnpm test        # vitest, passes with LM Studio closed
pnpm lint        # eslint
pnpm format      # prettier
```

## API

| Method | Route          | Purpose                                 |
| ------ | -------------- | --------------------------------------- |
| GET    | `/health`      | Reachability of LM Studio and the model |
| GET    | `/models`      | Models loaded in LM Studio              |
| GET    | `/prompts`     | System prompts available in `prompts/`  |
| POST   | `/chat`        | Full response as JSON                   |
| POST   | `/chat/stream` | Token-by-token response over SSE        |

Single-turn request:

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Explain what an embedding is in two sentences"}'
```

```json
{
  "answer": "...",
  "reasoning": "...",
  "finishReason": "stop",
  "truncated": false
}
```

Multi-turn: send the whole history instead. The client owns the history — the
server is stateless.

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[
        {"role":"user","content":"My name is Jose"},
        {"role":"assistant","content":"Nice to meet you, Jose."},
        {"role":"user","content":"What is my name?"}
      ]}'
```

Per-request overrides: `promptId`, `system`, `temperature`, `maxTokens`, `model`.

### Streaming

`/chat/stream` speaks Server-Sent Events. Every frame is a `ChatChunk`; a final
`done` event closes the stream.

```
data: {"kind":"reasoning","text":"First, the user asks..."}
data: {"kind":"content","text":"hello"}
event: done
data: {}
```

Ignore every `reasoning` frame if you only want the answer.

## Clients

### SDK

`sdk/` is a workspace package with no runtime dependencies. It uses `fetch`,
so it runs in browsers and in Node 22+.

```ts
import { ApiError, createClient } from "@ia-local/sdk";

const api = createClient({ baseUrl: "http://localhost:3000" });

await api.health(); // { status: "ok" | "unavailable", ... }; a 503 is returned, not thrown
await api.chat({ message: "hi", promptId: "coder" });

const controller = new AbortController();
for await (const chunk of api.chatStream(
  { messages },
  { signal: controller.signal },
)) {
  if (chunk.kind === "content") process.stdout.write(chunk.text);
}
```

- Every non-2xx answer throws `ApiError` with `status` and, for server errors,
  the `requestId` that matches the log line.
- `chatStream` also throws when the server reports an error mid-stream, shuts
  down, or the connection drops before `done`.
- Aborting the signal rejects with `AbortError` and stops generation on the
  server.

Inside the workspace the package resolves straight to its TypeScript source.
`pnpm build:sdk` emits `sdk/dist`, which is what `publishConfig` points at.

### Web chat

`web/` is Vite + React 19 + Zustand + Tailwind v4 + shadcn/ui. It has:

- streaming answers, with reasoning in a collapsible panel
- a Stop button
- model and prompt pickers
- an LM Studio health badge
- light and dark themes

The conversation is kept in `localStorage`, and the server stays stateless.

Vite proxies `/api/*` to the API, so the browser never talks to port 3000
directly. Set `API_URL` to point the proxy somewhere else. shadcn components
live in `web/src/components/ui/`; add more with
`pnpm dlx shadcn@latest add <name>` from `web/`.

## Prompts

System prompts live as markdown files in `prompts/`, one per persona, so they are
versioned and reviewable like any other source. `GET /prompts` lists them and a
request picks one by id:

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"El gato duerme en el tejado.","promptId":"translator"}'
```

Adding a prompt is dropping a `.md` file in `prompts/`. They are read once at
boot, so restart the process — or use `pnpm server`, which watches.

The system prompt is resolved by this precedence, first match wins:

1. a `system` turn inside `messages` — the client is managing the prompt itself
2. the `system` field of the request
3. the `promptId` field of the request
4. `SYSTEM_PROMPT` in `.env`
5. `prompts/default.md`

## The harness

`harness.ts` is the single place where a request becomes a message list. Both the
CLI and the HTTP API go through it, so they cannot drift apart. It owns:

- **Prompt resolution**, by the precedence above.
- **Model-family quirks.** Reasoning models want a lower temperature than chat
  models, and the original DeepSeek R1 wanted _no_ system role at all —
  instructions had to be folded into the user turn. R1-0528 added system prompt
  support, so the two generations are detected separately by `familyOf()`.
- **Context budget.** `trimHistory()` drops the oldest turns once the
  conversation exceeds `HISTORY_BUDGET` characters, never dropping the turn
  being answered.
- **Generation parameters.** `resolveParams()` applies per-request override →
  `.env` → family default. Leaving `TEMPERATURE` empty in `.env` is what lets
  the family default (0.6 for reasoning models) take effect.

## Logs and failures

The API logs to the console through [`@aglaya/logger`](https://www.npmjs.com/package/@aglaya/logger):
one line per request, plus the detail of anything that failed. Colors are on
only when stdout is a terminal, so piping to a file gives plain text.
`LOG_LEVEL` (`debug|info|warn|error|silent`) sets the floor.

Every line a single request produces carries the same short id, so a failure can
be traced back to its access-log line. The id travels in an `AsyncLocalStorage`
(`request-context.ts`), which is why route handlers never have to pass it
around, and it comes back in the body of `500` responses.

```
[2026-01-15T10:22:11.556Z] [INFO] API listening on http://localhost:3000
[2026-01-15T10:22:30.507Z] [WARN] [a1b2c3d4] GET /nope 404 1ms
[2026-01-15T10:23:11.740Z] [ERROR] [e5f6a7b8] POST /chat failed { message: 'Connection error.' }
[2026-01-15T10:23:11.742Z] [ERROR] [e5f6a7b8] POST /chat 500 1331ms
```

What is reported and how:

- **Malformed JSON body** → `400 {"error":"Malformed JSON body."}`. Without the
  handler Express answers with an HTML page containing a stack trace and
  absolute filesystem paths.
- **Unknown route** → `404` as JSON, not HTML.
- **LM Studio unreachable or the model not loaded** → `/health` answers `503`
  saying which one it is, and `/chat` answers `500` with the SDK message. The
  check calls `listModels()` on every request on purpose: with `MODEL` set in
  `.env` the model is resolved from cache, so a check built on `getModel()`
  alone reports "ok" with LM Studio down.
- **Errors during streaming** reach the client as an SSE `error` event, because
  the status line already went out with the headers. They are logged too, or
  they would be invisible.
- **Port already in use** → one line naming the port, instead of an unhandled
  `EADDRINUSE` stack trace.
- **Uncaught exceptions** are logged and the process exits. Unhandled
  rejections are logged and the process keeps serving: a dropped SSE connection
  can produce one, and killing the API for that is worse.

## Timeouts, cancellation and shutdown

- **Timeouts.** `REQUEST_TIMEOUT_MS` (2 minutes) and `MAX_RETRIES` (1) are
  passed to the OpenAI SDK, whose own defaults are 10 minutes and 2 retries — a
  hung LM Studio would otherwise hold a request open for the whole of it.
- **Cancellation.** A client that hangs up aborts the upstream generation
  through an `AbortSignal`, so LM Studio stops producing tokens nobody will
  read. Cancellations are logged at `debug`, not as errors: they are the
  expected outcome, not a failure.
- **Model swaps.** The active model is resolved once and cached. `POST
/models/refresh` (or `/model refresh` in the CLI) re-reads it, so swapping the
  model in LM Studio does not mean restarting. With `MODEL` empty in `.env`,
  `/health` also re-resolves on its own when the cached pick disappears.
- **Shutdown.** On `SIGINT`/`SIGTERM` the server stops accepting connections and
  closes open SSE streams with a final `event: shutdown` instead of dropping
  them mid-message — which is what `tsx watch` does on every restart.

## Working with reasoning models

DeepSeek R1 emits a chain of thought before the answer, and that matters in practice:

- **LM Studio returns it in a separate `reasoning_content` field**, not inline in
  `content`. It is exposed here as `reasoning` / frames of kind `reasoning`.
- **Some GGUF builds leave `<think>` tags inside `content` instead.** `think.ts`
  splits them out of both `/chat` and `/chat/stream`, including:
  - a tag split across chunks (`"<thi"` + `"nk>"`)
  - output with no opening tag, because the chat template injected it
  - a `</think>` that never arrives because the answer was truncated

  When the output has no opening tag, a reasoning-family model (`familyOf`) is
  assumed to be thinking until `</think>`, and a chat model is assumed to be
  answering. Tags mentioned in the middle of an answer are left as text.

- **It consumes the token budget.** A short answer can still burn 400+ tokens
  thinking, so `MAX_TOKENS` is 4096 by default. Too low and `content` comes back
  empty with `finishReason: "length"` — the response's `truncated` flag marks that case.
- **It is not fed back into the history.** Only the final answer is, so context is
  not wasted on old reasoning.
- For faster, non-reasoning replies, load a plain instruct model in LM Studio
  (e.g. Qwen or Gemma) and point `MODEL` at it.

## Layout

```
prompts/               system prompts, one .md per persona
src/
  config.ts            env loading and defaults
  prompts.ts           loads prompts/*.md into a registry
  harness.ts           prompt resolution, family quirks, history trimming
  request-context.ts   per-request id, via AsyncLocalStorage
  log.ts               logger setup and error helpers
  llm.ts               LM Studio client, chat() and chatStream()
  think.ts             splits inline <think> tags out of content, streamed or not
  cli.ts               terminal chat
  app.ts               the Express app: middleware, routes, validation
  server.ts            listen(), signal handling, graceful shutdown
  *.test.ts            vitest
sdk/src/
  index.ts             createClient(), ApiError, API types
  sse.ts               Server-Sent Events parser (EventSource cannot POST)
web/src/
  store.ts             chat state: history, streaming, persistence
  components/          Header, MessageList, Message, Composer
  components/ui/       shadcn/ui components
test/utils/            helpers shared by every test: startServer, collect,
                       streamOf, deferred, sleep
```

`app.ts` is separate from `server.ts` so the tests can mount the app on an
ephemeral port without the process-level handlers. `./llm.js` is mocked there,
which is what lets `pnpm test` pass with LM Studio closed.

`llm.ts` is the only file that knows about the model provider — swapping LM Studio
for Ollama or a cloud endpoint is a change of `LMSTUDIO_BASE_URL`.
