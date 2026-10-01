import { vi, type Mocked } from "vitest";
import type { LlmPort } from "../../src/llm.js";

/**
 * An LlmPort whose methods are all vi.fn(), for createApp. Starts with one
 * loaded model, "test-model"; tests override per case with mockResolvedValue
 * or mockImplementation.
 */
export function fakeLlm(): Mocked<LlmPort> {
  return {
    listModels: vi.fn<LlmPort["listModels"]>(async () => ["test-model"]),
    getModel: vi.fn<LlmPort["getModel"]>(async () => "test-model"),
    chat: vi.fn<LlmPort["chat"]>(),
    chatStream: vi.fn<LlmPort["chatStream"]>(),
  };
}
