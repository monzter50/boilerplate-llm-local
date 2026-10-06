# web

The IA-local chat UI: React 19, Vite, Zustand, Tailwind v4 and shadcn/ui. It
talks to the API through [`@ia-local/sdk`](../sdk/README.md).

## Running it

It needs the API running, and the API needs LM Studio with a model loaded.

```bash
# from the repo root
pnpm dev:all     # API on :3000 and this app on :5173, together

# or in two terminals
pnpm dev         # API
pnpm web         # this app → http://localhost:5173
```

The browser calls `/api/*` on the Vite origin, and Vite forwards it to the API.
So there is no CORS setup, and the UI doesn't need to know where the API runs.
Set `API_URL` to proxy somewhere other than `http://localhost:3000`.

```bash
pnpm --filter web build      # production bundle in web/dist
pnpm --filter web preview    # serve that bundle
pnpm --filter web typecheck
```

## What it does

- **Streams answers token by token**, rendered as GitHub-flavored Markdown with
  syntax-highlighted code and a copy button. Raw HTML from the model is shown as
  text and never run.
- **Shows the model's reasoning** in a collapsible panel, open while it thinks
  and closed once the answer starts.
- **Labels every answer:** "Thought for 8.2s", "No thinking" or "Skipped
  thinking", plus the model that answered.
- **Header:**
  - an LM Studio health badge, whose tooltip shows the web and server versions
  - a model picker, each model marked "Thinks" or "Direct"
  - a prompt picker
  - New chat
  - a light/dark toggle
- **Stop button:** aborts the stream, and the server stops generating.
- **Errors show inline** with the server's request id. A 429 means another
  generation is running.

## How it is built

```
src/
  main.tsx, App.tsx    entry and layout
  api.ts               the SDK client, at baseUrl "/api"
  store.ts             chat state (Zustand): history, streaming, persistence
  components/
    Header.tsx         health badge, model and prompt pickers, theme toggle
    MessageList.tsx    scrolling list, follows the stream
    Message.tsx        one turn: reasoning, answer, badges, errors
    Markdown.tsx       Markdown + highlighting, loaded as its own chunk
    ModelKindBadge.tsx "Reasoning model" / "Chat model", with when to use each
    Composer.tsx       input; Enter sends, Shift+Enter breaks the line
    ui/                shadcn/ui components (generated)
  lib/
    frameBatcher.ts    applies streamed tokens once per animation frame
    utils.ts           cn() for class names
```

Details worth knowing before changing things:

- **The server is stateless.** `store.ts` sends the history with every request,
  but only finished turns. Reasoning, failed answers and a stopped answer's
  half-text are never sent back.
- **The conversation persists** in `localStorage` (key `ia-local-chat`). An
  answer that was streaming when the page reloaded comes back as "stopped".
- **Tokens are batched per frame.** A fast model streams far more tokens a
  second than the screen can show, so `frameBatcher.ts` applies them once per
  animation frame instead of re-rendering the list for each one.
- **Markdown is lazy-loaded.** It roughly doubles the bundle, so it arrives as
  its own chunk with the first answer, which shows as plain text until then.
- **Theme:** colors are CSS variables in `src/index.css`, with a `.dark`
  variant. `index.html` applies the saved theme before first paint, so there is
  no white flash.
- **The version shown** comes from this package's `package.json`, injected by
  Vite at build time (`__APP_VERSION__`). release-please bumps it.

## Adding shadcn components

```bash
cd web
pnpm dlx shadcn@latest add <component>
```

Check the new file's imports afterwards. The CLI has resolved `@/lib/utils` to
an unrelated npm package called `cn` before. It should import from
`@/lib/utils`.

Commits that touch this app release under the `web` scope.
