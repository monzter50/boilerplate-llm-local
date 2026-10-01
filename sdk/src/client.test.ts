import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import type { ChatChunk, ChatOptions } from "../../src/llm.js";
import {
  collect,
  deferred,
  fakeLlm,
  sleep,
  startServer,
  streamOf,
  type TestServer,
} from "../../test/utils/index.js";
import { ApiError, createClient, type Client } from "./index.js";
import { parseSse } from "./sse.js";

// Same setup as src/app.test.ts: the real Express app with a fake LLM, so the
// SDK is checked against the real routes and SSE framing without LM Studio.
const mocks = fakeLlm();
const { app } = createApp({ llm: mocks, config });

let server: TestServer;
let client: Client;

beforeAll(async () => {
  server = await startServer(app);
  // Trailing slash on purpose: the SDK must strip it.
  client = createClient({ baseUrl: `${server.baseUrl}/` });
});

afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listModels.mockResolvedValue(["test-model"]);
  mocks.getModel.mockResolvedValue("test-model");
});

describe("simple routes", () => {
  it("unwraps models, prompts and the refreshed model", async () => {
    mocks.getModel.mockResolvedValue("swapped-model");

    await expect(client.models()).resolves.toEqual(["test-model"]);
    await expect(client.prompts()).resolves.toContain("default");
    await expect(client.refreshModel()).resolves.toBe("swapped-model");
  });

  it("labels each model with what kind it is", async () => {
    mocks.listModels.mockResolvedValue([
      "deepseek/deepseek-r1-0528-qwen3-8b",
      "qwen2.5-7b-instruct",
    ]);

    await expect(client.modelDetails()).resolves.toEqual([
      expect.objectContaining({ family: "reasoner", reasoning: true }),
      expect.objectContaining({ family: "chat", reasoning: false }),
    ]);
  });

  it("returns an unavailable health instead of throwing on 503", async () => {
    mocks.listModels.mockRejectedValue(new Error("Cannot reach LM Studio"));

    await expect(client.health()).resolves.toMatchObject({
      status: "unavailable",
      error: "Cannot reach LM Studio",
    });
  });

  it("throws ApiError for other failures", async () => {
    mocks.listModels.mockRejectedValue(new Error("Cannot reach LM Studio"));

    const error = await client.models().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503 });
  });
});

describe("chat()", () => {
  it("returns the answer", async () => {
    mocks.chat.mockResolvedValue({
      content: "hola",
      reasoning: "",
      finishReason: "stop",
    });

    await expect(client.chat({ message: "hi" })).resolves.toEqual({
      answer: "hola",
      finishReason: "stop",
      truncated: false,
      modelInfo: {
        id: "test-model",
        family: "chat",
        reasoning: false,
        supportsSystem: true,
      },
    });
  });

  it("flattens validation issues into the error message", async () => {
    const error = await client
      .chat({ message: "hi", promptId: "nope" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toMatch(/Unknown prompt 'nope'/);
  });

  it("carries the request id of a server error", async () => {
    mocks.chat.mockRejectedValue(new Error("Connection error."));

    const error = (await client
      .chat({ message: "hi" })
      .catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(500);
    expect(error.message).toBe("Connection error.");
    expect(error.requestId).toMatch(/^[0-9a-f]+$/);
  });
});

describe("chatStream()", () => {
  it("yields every chunk and ends on done", async () => {
    mocks.chatStream.mockImplementation(
      async function* (): AsyncGenerator<ChatChunk> {
        yield { kind: "reasoning", text: "hmm" };
        yield { kind: "content", text: "ho" };
        yield { kind: "content", text: "la" };
      },
    );

    await expect(
      collect(client.chatStream({ message: "hi" })),
    ).resolves.toEqual([
      { kind: "reasoning", text: "hmm" },
      { kind: "content", text: "ho" },
      { kind: "content", text: "la" },
    ]);
  });

  it("reports the answering model through onMeta, before any chunk", async () => {
    mocks.getModel.mockResolvedValue("deepseek-r1-distill-qwen-7b");
    mocks.chatStream.mockImplementation(
      async function* (): AsyncGenerator<ChatChunk> {
        yield { kind: "content", text: "hola" };
      },
    );

    const order: string[] = [];
    const onMeta = vi.fn(() => order.push("meta"));
    for await (const chunk of client.chatStream(
      { message: "hi" },
      { onMeta },
    )) {
      order.push(chunk.kind);
    }

    expect(order).toEqual(["meta", "content"]);
    expect(onMeta).toHaveBeenCalledWith({
      id: "deepseek-r1-distill-qwen-7b",
      family: "reasoner-legacy",
      reasoning: true,
      supportsSystem: false,
    });
  });

  it("throws a validation error before the stream starts", async () => {
    await expect(collect(client.chatStream({}))).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
    });
  });

  it("throws an error reported mid-stream, with its request id", async () => {
    mocks.chatStream.mockImplementation(
      async function* (): AsyncGenerator<ChatChunk> {
        yield { kind: "content", text: "partial" };
        throw new Error("model crashed");
      },
    );

    const seen: ChatChunk[] = [];
    const error = (await (async () => {
      for await (const chunk of client.chatStream({ message: "hi" })) {
        seen.push(chunk);
      }
    })().catch((e: unknown) => e)) as ApiError;

    expect(seen).toEqual([{ kind: "content", text: "partial" }]);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("model crashed");
    expect(error.requestId).toBeTruthy();
  });

  it("rejects with AbortError and stops the server when aborted", async () => {
    const serverAborted = deferred();

    mocks.chatStream.mockImplementation(async function* (
      _messages: unknown,
      options: ChatOptions = {},
    ): AsyncGenerator<ChatChunk> {
      options.signal?.addEventListener("abort", () => serverAborted.resolve(), {
        once: true,
      });
      yield { kind: "content", text: "first" };
      // Stands in for a slow model; the test aborts long before this ends.
      await sleep(5_000);
      yield { kind: "content", text: "never sent" };
    });

    const controller = new AbortController();
    const error = await (async () => {
      for await (const _chunk of client.chatStream(
        { message: "hi" },
        { signal: controller.signal },
      )) {
        controller.abort();
      }
    })().catch((e: unknown) => e);

    expect((error as Error).name).toBe("AbortError");
    await expect(serverAborted.promise).resolves.toBeUndefined();
  });
});

describe("parseSse()", () => {
  it("reassembles frames split across chunks", async () => {
    const body = streamOf(
      "da",
      'ta: {"a"',
      ":1}\n",
      "\nevent: do",
      "ne\ndata: {}\n\n",
    );

    await expect(collect(parseSse(body))).resolves.toEqual([
      { event: "message", data: '{"a":1}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("joins multi-line data and skips comments", async () => {
    const body = streamOf(": keep-alive\r\n\r\ndata: one\r\ndata: two\r\n\r\n");

    await expect(collect(parseSse(body))).resolves.toEqual([
      { event: "message", data: "one\ntwo" },
    ]);
  });
});
