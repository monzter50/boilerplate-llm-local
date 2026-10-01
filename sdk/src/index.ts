import { parseSse } from "./sse.js";

export { parseSse, type SseEvent } from "./sse.js";

// The API contract lives in packages/contracts, shared with the server, so
// the two cannot drift apart. Type-only on purpose: nothing from it is emitted
// into the SDK's JavaScript, which keeps zod out of a browser bundle. ESLint
// enforces it (see eslint.config.js).
import type {
  ChatChunk,
  ChatRequest,
  ChatResponse,
  ErrorResponse,
  HealthResponse,
  ModelInfo,
  ModelsResponse,
  PromptsResponse,
  RefreshModelResponse,
  StreamError,
} from "@ia-local/contracts";

export type {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ErrorResponse,
  HealthResponse,
  ModelInfo,
  ValidationIssue,
} from "@ia-local/contracts";

export type RequestOptions = {
  /** Aborting also stops the generation on the server. */
  signal?: AbortSignal;
};

export type StreamOptions = RequestOptions & {
  /** Called once, before the first chunk, with the model that is answering. */
  onMeta?: (info: ModelInfo) => void;
};

export type ClientOptions = {
  /** Where the API is served. Default http://localhost:3000. */
  baseUrl?: string;
  /** Injectable for tests or runtimes without a global fetch. */
  fetch?: typeof fetch;
};

/** Any non-2xx answer, or an error reported inside a stream. */
export class ApiError extends Error {
  readonly status: number;
  /** Matches the id in the server's log lines, when the server sent one. */
  readonly requestId?: string;
  readonly body: unknown;

  constructor(
    message: string,
    options: { status: number; requestId?: string; body?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

/**
 * The server answers errors as `{ error, requestId? }`, where `error` is a
 * string or, for a rejected body, the list of zod issues.
 */
function toApiError(status: number, body: unknown): ApiError {
  // Partial: a proxy in between can answer with something else entirely.
  const { error, requestId } = (body ?? {}) as Partial<ErrorResponse>;
  const message = Array.isArray(error)
    ? error.map((issue) => issue.message).join("; ")
    : (error ?? `Request failed with status ${status}`);

  return new ApiError(message, { status, requestId, body });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // A proxy in between can answer with HTML; keep it for debugging.
    return text;
  }
}

export type Client = ReturnType<typeof createClient>;

export function createClient(options: ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  // Bound so a browser's fetch is not called with the client as `this`.
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  function send(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return doFetch(`${baseUrl}${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await send(method, path, body, signal);
    const json = await readJson(response);
    if (!response.ok) throw toApiError(response.status, json);
    return json as T;
  }

  return {
    /**
     * Whether LM Studio is reachable and the model is loaded. A 503 is the
     * answer "unavailable", not a failure, so it is returned instead of thrown.
     */
    async health(options: RequestOptions = {}): Promise<HealthResponse> {
      const response = await send("GET", "/health", undefined, options.signal);
      const json = await readJson(response);
      if (response.ok || response.status === 503) return json as HealthResponse;
      throw toApiError(response.status, json);
    },

    /** Models loaded in LM Studio. */
    async models(options: RequestOptions = {}): Promise<string[]> {
      const res = await request<ModelsResponse>(
        "GET",
        "/models",
        undefined,
        options.signal,
      );
      return res.models;
    },

    /** Models loaded in LM Studio, with what kind of model each one is. */
    async modelDetails(options: RequestOptions = {}): Promise<ModelInfo[]> {
      const res = await request<ModelsResponse>(
        "GET",
        "/models",
        undefined,
        options.signal,
      );
      return res.details;
    },

    /** Re-resolves the active model, after swapping it in LM Studio. */
    async refreshModel(options: RequestOptions = {}): Promise<string> {
      const res = await request<RefreshModelResponse>(
        "POST",
        "/models/refresh",
        undefined,
        options.signal,
      );
      return res.model;
    },

    /** Ids of the system prompts in the server's prompts/ folder. */
    async prompts(options: RequestOptions = {}): Promise<string[]> {
      const res = await request<PromptsResponse>(
        "GET",
        "/prompts",
        undefined,
        options.signal,
      );
      return res.prompts;
    },

    /** Full response in one piece. */
    chat(
      body: ChatRequest,
      options: RequestOptions = {},
    ): Promise<ChatResponse> {
      return request<ChatResponse>("POST", "/chat", body, options.signal);
    },

    /**
     * Token-by-token response. Yields reasoning and content chunks as they
     * arrive and returns when the server closes the stream with `done`.
     * Errors reported mid-stream are thrown as ApiError.
     */
    async *chatStream(
      body: ChatRequest,
      options: StreamOptions = {},
    ): AsyncGenerator<ChatChunk> {
      const response = await send("POST", "/chat/stream", body, options.signal);

      // Validation errors are answered before the stream starts, as JSON.
      if (!response.ok)
        throw toApiError(response.status, await readJson(response));
      if (!response.body) {
        throw new ApiError("The response has no body to stream.", {
          status: response.status,
        });
      }

      for await (const frame of parseSse(response.body)) {
        switch (frame.event) {
          case "message":
            yield JSON.parse(frame.data) as ChatChunk;
            break;
          case "meta":
            options.onMeta?.(JSON.parse(frame.data) as ModelInfo);
            break;
          case "done":
            return;
          case "error":
            // The status line already said 200, so the error came in the stream.
            throw toApiError(500, JSON.parse(frame.data) as StreamError);
          case "shutdown":
            throw new ApiError(
              "The server shut down before the answer finished.",
              { status: 503 },
            );
        }
      }

      // Neither `done` nor an error: the connection dropped mid-answer.
      throw new ApiError("The stream ended before the answer finished.", {
        status: 502,
      });
    },
  };
}
