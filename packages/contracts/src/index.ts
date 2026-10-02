import { z } from "zod";

/*
 * The HTTP contract between the server and its clients, in one place.
 *
 * - The server validates requests with these schemas and types its responses
 *   with them (`satisfies`), so a change here fails to compile wherever the two
 *   sides disagree.
 * - The SDK only does `import type` from this package: nothing here ends up in
 *   its runtime code, so it does not drag zod into a browser bundle.
 * - Requests use z.input (what a client sends), responses z.infer (what the
 *   server produces). They only differ once a schema has a default or a
 *   transform, but then the difference matters.
 */

// --- Shared ---------------------------------------------------------------

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Stream frame: reasoning tokens and answer tokens arrive interleaved. */
export const chatChunkSchema = z.object({
  kind: z.enum(["reasoning", "content"]),
  text: z.string(),
});
export type ChatChunk = z.infer<typeof chatChunkSchema>;

/** How the server classifies a model (familyOf in src/harness.ts). */
export const modelInfoSchema = z.object({
  id: z.string(),
  /** "reasoner", "reasoner-legacy" or "chat". */
  family: z.string(),
  /** Thinks before answering: slower, better at math, code and logic. */
  reasoning: z.boolean(),
  /** False for the original DeepSeek R1, which takes no system role. */
  supportsSystem: z.boolean(),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;

/**
 * Every error the API answers with. `error` is a message, or for a rejected
 * request body the list of validation issues. `requestId` matches the
 * server's log lines and is present on 500s.
 */
export const validationIssueSchema = z.object({
  /** zod's issue code, e.g. "invalid_type" or "custom". */
  code: z.string(),
  /** Where in the body, e.g. ["messages", 0, "role"]. */
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const errorResponseSchema = z.object({
  error: z.union([z.string(), z.array(validationIssueSchema)]),
  requestId: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// --- POST /chat, POST /chat/stream ----------------------------------------

/**
 * The plain object, for a caller that needs to extend it. Most code wants
 * chatRequestSchema, which adds the message-or-messages rule.
 */
export const chatRequestObject = z.object({
  /** Single-turn shortcut. */
  message: z.string().min(1).optional(),
  /** Full conversation. The client owns the history: the server is stateless. */
  messages: z.array(chatMessageSchema).min(1).optional(),
  /** Raw system prompt text. Wins over promptId. */
  system: z.string().optional(),
  /** Id of a prompts/*.md file, as listed by GET /prompts. */
  promptId: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  model: z.string().optional(),
});

export const chatRequestSchema = chatRequestObject.refine(
  (body) => body.message || body.messages,
  { message: "Provide either 'message' or 'messages'." },
);
export type ChatRequest = z.input<typeof chatRequestSchema>;

export const chatResponseSchema = z.object({
  answer: z.string(),
  /** Chain of thought, for reasoning models such as DeepSeek R1. */
  reasoning: z.string().optional(),
  /** "length" means the model ran out of tokens before finishing. */
  finishReason: z.string().nullable(),
  /** The model hit the token budget, possibly before writing any answer. */
  truncated: z.boolean(),
  /** The model that answered. */
  modelInfo: modelInfoSchema,
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

/**
 * SSE frames of /chat/stream, in order: one `meta` event (ModelInfo), then
 * unnamed frames (ChatChunk), then `done`. On failure an `error` event
 * replaces `done`; on server shutdown, a `shutdown` event.
 */
export const streamErrorSchema = z.object({
  error: z.string(),
  requestId: z.string().optional(),
});
export type StreamError = z.infer<typeof streamErrorSchema>;

// --- GET /health, /models, /prompts; POST /models/refresh -----------------

export const healthResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    /** Server version, for bug reports: "which version are you running?" */
    version: z.string(),
    model: z.string(),
    info: modelInfoSchema,
    baseURL: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    version: z.string(),
    error: z.string(),
    baseURL: z.string().optional(),
  }),
]);
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const modelsResponseSchema = z.object({
  models: z.array(z.string()),
  /** Additive: `models` keeps its shape for older clients. */
  details: z.array(modelInfoSchema),
});
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;

export const refreshModelResponseSchema = z.object({ model: z.string() });
export type RefreshModelResponse = z.infer<typeof refreshModelResponseSchema>;

export const promptsResponseSchema = z.object({ prompts: z.array(z.string()) });
export type PromptsResponse = z.infer<typeof promptsResponseSchema>;
