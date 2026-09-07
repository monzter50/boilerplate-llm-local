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
pnpm server    # HTTP API on http://localhost:3000 (watch mode)
```

CLI commands: `/reset`, `/reasoning`, `/history`, `/help`, `/exit`.

## API

| Method | Route          | Purpose                                  |
| ------ | -------------- | ---------------------------------------- |
| GET    | `/health`      | Server status and active model           |
| GET    | `/models`      | Models loaded in LM Studio               |
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

Per-request overrides: `system`, `temperature`, `maxTokens`, `model`.

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
src/
  config.ts   env loading and defaults
  llm.ts      LM Studio client, chat() and chatStream()
  cli.ts      terminal chat
  server.ts   HTTP API
```

`llm.ts` is the only file that knows about the model provider — swapping LM Studio
for Ollama or a cloud endpoint is a change of `LMSTUDIO_BASE_URL`.
