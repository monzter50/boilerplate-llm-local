import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  deferred,
  fakeLlm,
  sleep,
  startServer,
  type TestServer,
} from "../test/utils/index.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import type { ChatChunk, ChatMessage, ChatOptions } from "./llm.js";

// Every route reaches LM Studio through the injected LLM, so a fake one is
// what lets the whole suite run in CI with nothing listening on 1234.
const mocks = fakeLlm();
const { app } = createApp({ llm: mocks, config });

let server: TestServer;
let baseUrl: string;

beforeAll(async () => {
  server = await startServer(app);
  baseUrl = server.baseUrl;
});

afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listModels.mockResolvedValue(["test-model"]);
  mocks.getModel.mockResolvedValue("test-model");
});

const post = (path: string, body: unknown, init?: RequestInit) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });

describe("error responses", () => {
  it("answers malformed JSON with JSON, not Express's HTML page", async () => {
    const response = await post("/chat", '{"message":');

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    await expect(response.json()).resolves.toEqual({
      error: "Malformed JSON body.",
    });
  });

  it("answers an unknown route with JSON", async () => {
    const response = await fetch(`${baseUrl}/nope`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No route for GET /nope",
    });
  });

  it("rejects a body with neither message nor messages", async () => {
    const response = await post("/chat", {});

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string }[] };
    expect(body.error[0]?.message).toMatch(
      /Provide either 'message' or 'messages'/,
    );
  });

  it("names the available prompts when promptId is unknown", async () => {
    const response = await post("/chat", { message: "hi", promptId: "nope" });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string }[] };
    expect(body.error[0]?.message).toMatch(/Unknown prompt 'nope'/);
    expect(body.error[0]?.message).toMatch(/coder/);
  });
});

describe("GET /health", () => {
  it("reports ok when LM Studio answers and the model is loaded", async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      model: "test-model",
    });
  });

  it("reports 503 when LM Studio cannot be reached", async () => {
    mocks.listModels.mockRejectedValue(new Error("Cannot reach LM Studio"));

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("re-resolves before giving up when the cached model is gone", async () => {
    mocks.listModels.mockResolvedValue(["another-model"]);
    mocks.getModel.mockResolvedValue("stale-model");

    const response = await fetch(`${baseUrl}/health`);

    // The cache is stale, so a refresh is attempted before reporting failure.
    expect(mocks.getModel).toHaveBeenCalledWith({ refresh: true });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/another-model/);
  });
});

describe("GET /health with MODEL set in .env", () => {
  it("reports the pinned model as missing instead of picking another", async () => {
    const llm = fakeLlm();
    llm.listModels.mockResolvedValue(["another-model"]);
    llm.getModel.mockResolvedValue("pinned-model");

    // A second app with its own config: no module mocking needed for that.
    const pinned = await startServer(
      createApp({ llm, config: { ...config, model: "pinned-model" } }).app,
    );
    try {
      const response = await fetch(`${pinned.baseUrl}/health`);

      // The user asked for this model, so silently switching would hide the
      // problem: no refresh, and a 503 that names both.
      expect(llm.getModel).not.toHaveBeenCalledWith({ refresh: true });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/'pinned-model' is not loaded/);
      expect(body.error).toMatch(/another-model/);
    } finally {
      await pinned.close();
    }
  });
});

describe("POST /models/refresh", () => {
  it("re-reads the model from LM Studio", async () => {
    mocks.getModel.mockResolvedValue("swapped-model");

    const response = await post("/models/refresh", {});

    expect(mocks.getModel).toHaveBeenCalledWith({ refresh: true });
    await expect(response.json()).resolves.toEqual({ model: "swapped-model" });
  });
});

describe("POST /chat/stream", () => {
  it("emits one frame per chunk and closes with a done event", async () => {
    mocks.chatStream.mockImplementation(
      async function* (): AsyncGenerator<ChatChunk> {
        yield { kind: "reasoning", text: "hmm" };
        yield { kind: "content", text: "hola" };
      },
    );

    const response = await post("/chat/stream", { message: "hi" });
    const body = await response.text();

    expect(body).toContain('data: {"kind":"reasoning","text":"hmm"}');
    expect(body).toContain('data: {"kind":"content","text":"hola"}');
    expect(body.trimEnd().endsWith("event: done\ndata: {}")).toBe(true);
  });

  it("aborts the upstream generation when the client hangs up", async () => {
    let captured: AbortSignal | undefined;
    const aborted = deferred();

    mocks.chatStream.mockImplementation(async function* (
      _messages: ChatMessage[],
      options: ChatOptions = {},
    ): AsyncGenerator<ChatChunk> {
      captured = options.signal;
      options.signal?.addEventListener("abort", () => aborted.resolve(), {
        once: true,
      });

      yield { kind: "content", text: "first" };

      // Stays open until the test hangs up, standing in for a slow model.
      await sleep(5_000);
      yield { kind: "content", text: "never sent" };
    });

    const controller = new AbortController();
    const response = await post(
      "/chat/stream",
      { message: "hi" },
      { signal: controller.signal },
    );

    // Wait for the first frame so the generator is running, then hang up.
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();

    await expect(aborted.promise).resolves.toBeUndefined();
    expect(captured?.aborted).toBe(true);
  });
});
