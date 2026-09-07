import express from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import {
  chat,
  chatStream,
  getModel,
  listModels,
  type ChatMessage,
} from "./llm.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

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
    system: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    model: z.string().optional(),
  })
  .refine((body) => body.message || body.messages, {
    message: "Provide either 'message' or 'messages'.",
  });

type ChatBody = z.infer<typeof chatBodySchema>;

/** Normalizes both request shapes into a message list with a system prompt. */
function buildMessages(body: ChatBody): ChatMessage[] {
  const messages: ChatMessage[] = body.messages
    ? [...body.messages]
    : [{ role: "user", content: body.message! }];

  if (messages[0]?.role !== "system") {
    messages.unshift({
      role: "system",
      content: body.system ?? config.systemPrompt,
    });
  }

  return messages;
}

app.get("/health", async (_req, res) => {
  try {
    const model = await getModel();
    res.json({ status: "ok", model, baseURL: config.baseURL });
  } catch (error) {
    res
      .status(503)
      .json({ status: "unavailable", error: (error as Error).message });
  }
});

app.get("/models", async (_req, res) => {
  try {
    res.json({ models: await listModels() });
  } catch (error) {
    res.status(503).json({ error: (error as Error).message });
  }
});

app.post("/chat", async (req, res) => {
  const parsed = chatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  try {
    const result = await chat(buildMessages(parsed.data), {
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      model: parsed.data.model,
    });

    res.json({
      answer: result.content,
      reasoning: result.reasoning || undefined,
      finishReason: result.finishReason,
      // Reasoning models can burn the whole budget thinking and return nothing.
      truncated: result.finishReason === "length",
    });
  } catch (error) {
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
    for await (const chunk of chatStream(buildMessages(parsed.data), {
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      model: parsed.data.model,
    })) {
      if (clientGone) break;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write("event: done\ndata: {}\n\n");
  } catch (error) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: (error as Error).message })}\n\n`,
    );
  } finally {
    res.end();
  }
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  console.log(`LM Studio at ${config.baseURL}`);
});
