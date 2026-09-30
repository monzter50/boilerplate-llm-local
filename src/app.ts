import express, { type ErrorRequestHandler, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { buildMessages, describeModel } from "./harness.js";
import { describeError, isAbortError, log } from "./log.js";
import { hasPrompt, listPrompts } from "./prompts.js";
import { chat, chatStream, getModel, listModels } from "./llm.js";
import {
  bindRequestContext,
  currentRequestId,
  newRequestId,
  runWithRequestId,
} from "./request-context.js";

export const app = express();

/**
 * Open SSE responses, so a shutdown can close them with a final frame instead
 * of dropping the connection mid-message.
 */
export const openStreams = new Set<Response>();

app.use(cors());

// Access log. Registered before the body parser so requests with an unreadable
// body are logged too, and reported on "finish" so the status is known. The
// request id wraps everything downstream, which is what lets a route's own
// error lines be correlated with this one.
app.use((req, res, next) => {
  runWithRequestId(newRequestId(), () => {
    const start = process.hrtime.bigint();

    res.on(
      "finish",
      bindRequestContext(() => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`;

        if (res.statusCode >= 500) log.error(line);
        else if (res.statusCode >= 400) log.warn(line);
        else log.info(line);
      }),
    );

    next();
  });
});

app.use(express.json({ limit: "1mb" }));

/**
 * body-parser rejects malformed JSON by throwing. Without this handler the
 * client gets Express's default HTML error page, stack trace and absolute
 * filesystem paths included.
 */
const onBodyError: ErrorRequestHandler = (error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    log.warn("malformed JSON body", {
      path: req.path,
      message: error.message,
    });
    res.status(400).json({ error: "Malformed JSON body." });
    return;
  }
  next(error);
};
app.use(onBodyError);

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const chatBodySchema = z
  .object({
    /** Single-turn shortcut. */
    message: z.string().min(1).optional(),
    /** Full conversation, when the client keeps the history. */
    messages: z.array(messageSchema).min(1).optional(),
    /** Raw system prompt text. Wins over promptId. */
    system: z.string().optional(),
    /** Id of a prompts/*.md file, as listed by GET /prompts. */
    promptId: z
      .string()
      .refine(hasPrompt, (id) => ({
        message: `Unknown prompt '${id}'. Available: ${listPrompts().join(", ")}`,
      }))
      .optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    model: z.string().optional(),
  })
  .refine((body) => body.message || body.messages, {
    message: "Provide either 'message' or 'messages'.",
  });

/**
 * Aborts the upstream generation when the client hangs up. "close" also fires
 * after a normal response, hence the writableEnded guard.
 */
function abortOnDisconnect(
  res: Response,
  onAbort?: () => void,
): AbortController {
  const controller = new AbortController();

  res.on(
    "close",
    bindRequestContext(() => {
      if (res.writableEnded) return;
      controller.abort();
      onAbort?.();
    }),
  );

  return controller;
}

app.get("/health", async (_req, res) => {
  try {
    // listModels() before getModel(): when MODEL is set in .env the model is
    // resolved from cache, so a check built on getModel() alone never touches
    // the network and reports "ok" with LM Studio down.
    const models = await listModels();
    let model = await getModel();

    // With MODEL unset the cached pick goes stale as soon as the model is
    // swapped in LM Studio. Re-resolve rather than report a failure the caller
    // cannot act on. With MODEL set the mismatch is real and worth reporting.
    if (!models.includes(model) && !config.model) {
      model = await getModel({ refresh: true });
    }

    // A configured model that is not loaded only fails on the first
    // completion, which is far from the cause. Surface it here instead.
    if (!models.includes(model)) {
      log.warn("configured model is not loaded in LM Studio", {
        model,
        loaded: models,
      });
      res.status(503).json({
        status: "unavailable",
        error: `Model '${model}' is not loaded in LM Studio. Loaded: ${models.join(", ") || "(none)"}.`,
        baseURL: config.baseURL,
      });
      return;
    }

    res.json({
      status: "ok",
      model,
      info: describeModel(model),
      baseURL: config.baseURL,
    });
  } catch (error) {
    log.warn("health check failed", describeError(error));
    res
      .status(503)
      .json({ status: "unavailable", error: (error as Error).message });
  }
});

app.get("/models", async (_req, res) => {
  try {
    const models = await listModels();
    // `details` is additive: `models` keeps its shape for older clients.
    res.json({ models, details: models.map(describeModel) });
  } catch (error) {
    log.error("GET /models failed", describeError(error));
    res.status(503).json({ error: (error as Error).message });
  }
});

/** Re-resolves the active model, for when it was swapped in LM Studio. */
app.post("/models/refresh", async (_req, res) => {
  try {
    const model = await getModel({ refresh: true });
    log.info("model cache refreshed", { model });
    res.json({ model });
  } catch (error) {
    log.error("POST /models/refresh failed", describeError(error));
    res.status(503).json({ error: (error as Error).message });
  }
});

app.get("/prompts", (_req, res) => {
  res.json({ prompts: listPrompts() });
});

app.post("/chat", async (req, res) => {
  const parsed = chatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("POST /chat rejected", { issues: parsed.error.issues });
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const controller = abortOnDisconnect(res, () => {
    log.info("client hung up, generation stopped");
  });

  try {
    const model = parsed.data.model ?? (await getModel());
    const result = await chat(buildMessages({ ...parsed.data, model }), {
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      model,
      signal: controller.signal,
    });

    if (result.finishReason === "length") {
      log.warn("answer truncated: the model hit the token budget", {
        model,
        maxTokens: parsed.data.maxTokens ?? config.maxTokens,
      });
    }

    res.json({
      answer: result.content,
      reasoning: result.reasoning || undefined,
      finishReason: result.finishReason,
      // Reasoning models can burn the whole budget thinking and return nothing.
      truncated: result.finishReason === "length",
      modelInfo: describeModel(model),
    });
  } catch (error) {
    // Nobody is listening once the request was aborted, so there is nothing to
    // report and nothing went wrong.
    if (isAbortError(error)) {
      log.debug("POST /chat aborted by the client");
      return;
    }

    log.error("POST /chat failed", describeError(error));
    res.status(500).json({
      error: (error as Error).message,
      requestId: currentRequestId(),
    });
  }
});

/**
 * Server-Sent Events. A `meta` event describes the model first, then each
 * frame is `{ kind: "reasoning" | "content", text }`, followed by a `done`
 * event. Clients that only want the answer can ignore every frame whose kind
 * is "reasoning".
 */
app.post("/chat/stream", async (req, res) => {
  const parsed = chatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("POST /chat/stream rejected", { issues: parsed.error.issues });
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  openStreams.add(res);

  // Disconnect must be watched on the response, not the request: `req` emits
  // "close" as soon as the body has been consumed, which is immediately.
  let clientGone = false;
  const controller = abortOnDisconnect(res, () => {
    clientGone = true;
    log.info("client disconnected mid-stream, generation stopped");
  });

  try {
    const model = parsed.data.model ?? (await getModel());
    const messages = buildMessages({ ...parsed.data, model });

    // A named event, so clients that only read the default "message" frames
    // (EventSource semantics) never see it. It tells the UI which model is
    // answering and whether to expect reasoning frames.
    res.write(`event: meta\ndata: ${JSON.stringify(describeModel(model))}\n\n`);

    for await (const chunk of chatStream(messages, {
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      model,
      signal: controller.signal,
    })) {
      if (clientGone) break;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    if (!clientGone) res.write("event: done\ndata: {}\n\n");
  } catch (error) {
    if (clientGone || isAbortError(error)) {
      log.debug("stream aborted before it finished");
    } else {
      // The status line went out with the headers, so the error can only be
      // reported inside the stream — and on the console, or it is invisible.
      log.error("POST /chat/stream failed", describeError(error));
      res.write(
        `event: error\ndata: ${JSON.stringify({
          error: (error as Error).message,
          requestId: currentRequestId(),
        })}\n\n`,
      );
    }
  } finally {
    openStreams.delete(res);
    res.end();
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

/** Last resort: anything a route threw synchronously and did not handle. */
const onError: ErrorRequestHandler = (error, req, res, _next) => {
  log.error(
    `unhandled error on ${req.method} ${req.path}`,
    describeError(error),
  );

  if (res.headersSent) {
    res.end();
    return;
  }
  res
    .status(500)
    .json({ error: "Internal server error.", requestId: currentRequestId() });
};
app.use(onError);
