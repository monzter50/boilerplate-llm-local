# @ia-local/contracts

The HTTP contract of the IA-local API, as [zod](https://zod.dev) schemas and the
types inferred from them. The server and the SDK both build on it, so they can't
drift apart.

```ts
import { chatRequestSchema, type ChatResponse } from "@ia-local/contracts";
```

## Who uses it, and how

| Consumer        | Uses                                  | Why                                                                        |
| --------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| Server (`src/`) | the schemas, at runtime               | to validate request bodies, and to check every response with `satisfies`   |
| SDK (`sdk/`)    | the types only, through `import type` | so zod never reaches a browser bundle. ESLint rejects a value import there |
| Web (`web/`)    | nothing directly                      | it uses the SDK, which re-exports the types                                |

A change here is a change to the API. If the server stops matching it,
`pnpm typecheck` fails. Commits that touch this package release under the
`contracts` scope (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).

## What it defines

| Schema                       | Type                   | Used for                                                                 |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| `chatMessageSchema`          | `ChatMessage`          | one turn: `{ role: "system" \| "user" \| "assistant", content }`         |
| `chatRequestSchema`          | `ChatRequest`          | body of `POST /chat` and `POST /chat/stream`                             |
| `chatRequestObject`          | —                      | the same, before the message-or-messages rule, to extend                 |
| `chatResponseSchema`         | `ChatResponse`         | `POST /chat`                                                             |
| `chatChunkSchema`            | `ChatChunk`            | each frame of `/chat/stream`: `{ kind: "reasoning" \| "content", text }` |
| `streamErrorSchema`          | `StreamError`          | the stream's `error` event                                               |
| `modelInfoSchema`            | `ModelInfo`            | what kind of model answered (`reasoning`, `family`, …)                   |
| `healthResponseSchema`       | `HealthResponse`       | `GET /health`: `ok` or `unavailable`, with the server `version`          |
| `modelsResponseSchema`       | `ModelsResponse`       | `GET /models`                                                            |
| `refreshModelResponseSchema` | `RefreshModelResponse` | `POST /models/refresh`                                                   |
| `promptsResponseSchema`      | `PromptsResponse`      | `GET /prompts`                                                           |
| `errorResponseSchema`        | `ErrorResponse`        | every error body: a message, or a list of validation issues              |
| `validationIssueSchema`      | `ValidationIssue`      | one rejected field: `{ code, path, message }`                            |

Request types use `z.input` (what a client sends) and response types use
`z.infer` (what the server produces). They are the same today, and only differ
once a schema has a default or a transform.

### The stream, frame by frame

`POST /chat/stream` answers with Server-Sent Events, in this order:

1. One `meta` event: a `ModelInfo` describing the model that is answering.
2. Unnamed frames, each a `ChatChunk`.
3. A `done` event. Instead, an `error` event (a `StreamError`) if it failed, or
   a `shutdown` event if the server stopped.

## Changing the contract

1. Edit the schema in `src/index.ts`.
2. Run `pnpm typecheck`. Every server response or SDK use that no longer matches
   fails here. Fix them in the same change.
3. A field that existing clients rely on, removed or renamed, is a breaking
   change: use `feat(contracts)!:` in the commit.

Some checks only the server can make. They stay in the server, layered on top
with `superRefine`. For example, the server checks that a `promptId` names a
file in `prompts/`, because only it has those files.

## How it resolves

Inside this repo, dev, tests and typecheck all use the TypeScript source,
through a `source` export condition. Plain Node, as in `pnpm start`, loads the
compiled `dist/`. That is why `pnpm build` builds this package before the
server.

```bash
pnpm --filter @ia-local/contracts build      # emit dist/
pnpm --filter @ia-local/contracts typecheck
```
