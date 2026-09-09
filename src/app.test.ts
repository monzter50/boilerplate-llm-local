import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ChatChunk, ChatMessage, ChatOptions } from "./llm.js";

// Every route reaches LM Studio through ./llm.js, so mocking it is what lets
// the whole suite run in CI with nothing listening on 1234.
const mocks = vi.hoisted(() => ({
  listModels: vi.fn<() => Promise<string[]>>(),
  getModel: vi.fn<(options?: { refresh?: boolean }) => Promise<string>>(),
  chat: vi.fn(),
  chatStream: vi.fn(),
}));

vi.mock("./llm.js", () => ({
  listModels: mocks.listModels,
  getModel: mocks.getModel,
  chat: mocks.chat,
  chatStream: mocks.chatStream,
  clearModelCache: vi.fn(),
}));

const { app } = await import("./app.js");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

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
    // Not Promise.withResolvers: that is ES2024 and this project supports
    // Node 20, where it does not exist.
    let onAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      onAbort = resolve;
    });

    mocks.chatStream.mockImplementation(async function* (
      _messages: ChatMessage[],
      options: ChatOptions = {},
    ): AsyncGenerator<ChatChunk> {
      captured = options.signal;
      options.signal?.addEventListener("abort", () => onAbort(), {
        once: true,
      });

      yield { kind: "content", text: "first" };

      // Stays open until the test hangs up, standing in for a slow model.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
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

    await expect(aborted).resolves.toBeUndefined();
    expect(captured?.aborted).toBe(true);
  });
});
