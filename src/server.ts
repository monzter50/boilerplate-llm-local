import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { buildMessages } from "./harness.js";
import { describeError, log } from "./log.js";
import { hasPrompt, listPrompts } from "./prompts.js";
import { chat, chatStream, getModel, listModels } from "./llm.js";

const app = express();
app.use(cors());

// Access log. Registered before the body parser so requests with an unreadable
// body are logged too, and reported on "finish" so the status is known.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`;

    if (res.statusCode >= 500) log.error(line);
    else if (res.statusCode >= 400) log.warn(line);
    else log.info(line);
  });

  next();
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

app.get("/health", async (_req, res) => {
  try {
    // listModels() before getModel(): when MODEL is set in .env the model is
    // resolved from cache, so a check built on getModel() alone never touches
    // the network and reports "ok" with LM Studio down.
    const models = await listModels();
    const model = await getModel();

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

    res.json({ status: "ok", model, baseURL: config.baseURL });
  } catch (error) {
    log.warn("health check failed", describeError(error));
    res
      .status(503)
      .json({ status: "unavailable", error: (error as Error).message });
  }
});

app.get("/models", async (_req, res) => {
  try {
    res.json({ models: await listModels() });
  } catch (error) {
    log.error("GET /models failed", describeError(error));
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

  try {
    const model = parsed.data.model ?? (await getModel());
    const result = await chat(buildMessages({ ...parsed.data, model }), {
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      model,
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
    });
  } catch (error) {
    log.error("POST /chat failed", describeError(error));
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Server-Sent Events. Each frame is `{ kind: "reasoning" | "content", text }`,
 * followed by a `done` event. Clients that only want the answer can ignore
 * every frame whose kind is "reasoning".
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

  // Disconnect must be watched on the response, not the request: `req` emits
  // "close" as soon as the body has been consumed, which is immediately.
  let clientGone = false;
  res.on("close", () => {
    clientGone = true;
  });

  try {
    const model = parsed.data.model ?? (await getModel());
    const messages = buildMessages({ ...parsed.data, model });

    for await (const chunk of chatStream(messages, {
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      model,
    })) {
      if (clientGone) {
        log.info("client disconnected mid-stream, generation stopped");
        break;
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write("event: done\ndata: {}\n\n");
  } catch (error) {
    // The status line went out with the headers, so the error can only be
    // reported inside the stream — and on the console, or it is invisible.
    log.error("POST /chat/stream failed", describeError(error));
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: (error as Error).message })}\n\n`,
    );
  } finally {
    res.end();
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

/** Last resort: anything a route threw synchronously and did not handle. */
const onError: ErrorRequestHandler = (error, req, res, _next) => {
  log.error(`unhandled error on ${req.method} ${req.path}`, describeError(error));

  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({ error: "Internal server error." });
};
app.use(onError);

const server = app.listen(config.port, () => {
  log.info(`API listening on http://localhost:${config.port}`);
  log.info(`LM Studio at ${config.baseURL}`);
  log.info(`prompts: ${listPrompts().join(", ") || "(none)"}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    log.error(
      `Port ${config.port} is already in use. Stop the process holding it, or set PORT in .env.`,
    );
  } else {
    log.error("server failed to start", describeError(error));
  }
  process.exit(1);
});

// A dropped SSE connection can surface as a stray rejection; killing the API
// for that would be worse than logging it, so this one does not exit.
process.on("unhandledRejection", (reason) => {
  log.error("unhandled promise rejection", describeError(reason));
});

// An uncaught exception leaves the process in an unknown state: log it and go.
process.on("uncaughtException", (error) => {
  log.error("uncaught exception", describeError(error));
  process.exit(1);
});
