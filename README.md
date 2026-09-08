# IA-local

Local AI chat backed by **DeepSeek running in LM Studio**. No cloud calls, no API keys.

Two entry points share one LLM client:

- a **terminal chat** with streaming and conversation history
- an **HTTP API** (`/chat`, `/chat/stream`) to plug a frontend into later

## Requirements

- Node.js 20+ and pnpm
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
```

> `pnpm server` does **not** work: `server` is a built-in pnpm command that
> manages its store server, and it shadows the script of the same name — it
> exits with code 0 without printing anything. Use `pnpm dev`, or
> `pnpm run server`, which forces the script.

CLI commands: `/prompt [id]`, `/reset`, `/reasoning`, `/history`, `/help`, `/exit`.

## API

| Method | Route          | Purpose                                  |
| ------ | -------------- | ---------------------------------------- |
| GET    | `/health`      | Reachability of LM Studio and the model  |
| GET    | `/models`      | Models loaded in LM Studio               |
| GET    | `/prompts`     | System prompts available in `prompts/`   |
| POST   | `/chat`        | Full response as JSON                    |
| POST   | `/chat/stream` | Token-by-token response over SSE         |

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
  models, and the original DeepSeek R1 wanted *no* system role at all —
  instructions had to be folded into the user turn. R1-0528 added system prompt
  support, so the two generations are detected separately by `familyOf()`.
- **Context budget.** `trimHistory()` drops the oldest turns once the
  conversation exceeds `HISTORY_BUDGET` characters, never dropping the turn
  being answered.
- **Generation parameters.** `resolveParams()` applies per-request override →
  `.env` → family default. Leaving `TEMPERATURE` empty in `.env` is what lets
  the family default (0.6 for reasoning models) take effect.

## Logs and failures

The API logs to the console: one line per request, plus the detail of anything
that failed. Levels are colored only when stdout is a terminal, so piping to a
file gives plain text. `error` goes to stderr, everything else to stdout.

```
2026-01-15T10:22:11.556Z INFO  API listening on http://localhost:3000
2026-01-15T10:22:30.507Z WARN  GET /nope 404 1ms
2026-01-15T10:23:11.740Z ERROR POST /chat failed { message: 'Connection error.', stack: '...' }
2026-01-15T10:23:11.742Z ERROR POST /chat 500 1331ms
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

## Working with reasoning models

DeepSeek R1 emits a chain of thought before the answer, and that matters in practice:

- **LM Studio returns it in a separate `reasoning_content` field**, not inline in
  `content`. It is exposed here as `reasoning` / frames of kind `reasoning`.
- **It consumes the token budget.** A short answer can still burn 400+ tokens
  thinking, so `MAX_TOKENS` is 4096 by default. Too low and `content` comes back
  empty with `finishReason: "length"` — the response's `truncated` flag marks that case.
- **It is not fed back into the history.** Only the final answer is, so context is
  not wasted on old reasoning.
- For faster, non-reasoning replies, load a plain instruct model in LM Studio
  (e.g. Qwen or Gemma) and point `MODEL` at it.

## Layout

```
prompts/      system prompts, one .md per persona
src/
  config.ts   env loading and defaults
  prompts.ts  loads prompts/*.md into a registry
  harness.ts  prompt resolution, family quirks, history trimming
  log.ts      timestamped console logger
  llm.ts      LM Studio client, chat() and chatStream()
  cli.ts      terminal chat
  server.ts   HTTP API
```

`llm.ts` is the only file that knows about the model provider — swapping LM Studio
for Ollama or a cloud endpoint is a change of `LMSTUDIO_BASE_URL`.
