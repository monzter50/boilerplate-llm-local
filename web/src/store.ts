import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ApiError,
  type ChatChunk,
  type ChatMessage,
  type ModelInfo,
} from "@ia-local/sdk";
import { api } from "./api";
import { createFrameBatcher } from "./lib/frameBatcher";

export type MessageStatus = "streaming" | "done" | "error" | "stopped";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Chain of thought; shown collapsed, never sent back to the server. */
  reasoning: string;
  status: MessageStatus;
  error?: string;
  requestId?: string;
  /** The model that answered, as the server classifies it. */
  modelInfo?: ModelInfo;
  /** Time from the first reasoning token to the first answer token. */
  thinkingMs?: number;
};

type ChatState = {
  messages: UiMessage[];
  /** Undefined = whatever model the server resolves. */
  model?: string;
  /** Undefined = the server's default prompt. */
  promptId?: string;
  streaming: boolean;

  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  setModel: (model: string | undefined) => void;
  setPromptId: (promptId: string | undefined) => void;
};

// Outside the store: not serializable, and never worth persisting.
let controller: AbortController | null = null;

/**
 * The server is stateless, so every request carries the history. Only
 * finished turns go in: no reasoning (it would waste context), and no failed
 * or stopped answers, nor the user turn left without a reply.
 */
function toHistory(messages: UiMessage[]): ChatMessage[] {
  const history: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const last = history[history.length - 1];
      if (m.status === "done" && m.content && last?.role === "user") {
        history.push({ role: "assistant", content: m.content });
      } else if (last?.role === "user") {
        history.pop();
      }
    } else {
      // Two user turns in a row: the first never got an answer.
      if (history[history.length - 1]?.role === "user") history.pop();
      history.push({ role: "user", content: m.content });
    }
  }
  return history;
}

export const useChat = create<ChatState>()(
  persist(
    (set, get) => {
      /** Applies a change to the message with this id only. */
      const patch = (id: string, fn: (m: UiMessage) => Partial<UiMessage>) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, ...fn(m) } : m,
          ),
        }));

      return {
        messages: [],
        streaming: false,

        async send(text) {
          const content = text.trim();
          if (!content || get().streaming) return;

          const user: UiMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content,
            reasoning: "",
            status: "done",
          };
          const reply: UiMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "",
            reasoning: "",
            status: "streaming",
          };

          const messages = [...get().messages, user];
          set({ messages: [...messages, reply], streaming: true });

          controller = new AbortController();
          const { model, promptId } = get();

          // Thinking time runs from the first reasoning token until the answer
          // starts, or until the stream ends for an answer that never came.
          let thinkingSince: number | null = null;
          const stopThinkingClock = (): Partial<UiMessage> => {
            if (thinkingSince === null) return {};
            const thinkingMs = performance.now() - thinkingSince;
            thinkingSince = null;
            return { thinkingMs };
          };

          // Tokens are applied once per frame, not once each: a fast model
          // would otherwise rebuild and re-render the list hundreds of times
          // a second.
          const tokens = createFrameBatcher<
            ChatChunk & Pick<UiMessage, "thinkingMs">
          >((batch) =>
            patch(reply.id, (m) => {
              let { content, reasoning, thinkingMs } = m;
              for (const token of batch) {
                if (token.kind === "content") content += token.text;
                else reasoning += token.text;
                thinkingMs = token.thinkingMs ?? thinkingMs;
              }
              return { content, reasoning, thinkingMs };
            }),
          );

          try {
            const stream = api.chatStream(
              { messages: toHistory(messages), model, promptId },
              {
                signal: controller.signal,
                onMeta: (modelInfo) => patch(reply.id, () => ({ modelInfo })),
              },
            );
            for await (const chunk of stream) {
              // Timing is measured when the token arrives, not when the frame
              // that shows it runs.
              if (chunk.kind === "reasoning") {
                thinkingSince ??= performance.now();
              }
              tokens.push({
                ...chunk,
                ...(chunk.kind === "content" ? stopThinkingClock() : {}),
              });
            }
            tokens.flush();
            patch(reply.id, () => ({ ...stopThinkingClock(), status: "done" }));
          } catch (error) {
            // Show what arrived before the stream ended, then the outcome.
            tokens.flush();
            if ((error as Error).name === "AbortError") {
              patch(reply.id, () => ({
                ...stopThinkingClock(),
                status: "stopped",
              }));
            } else {
              patch(reply.id, () => ({
                status: "error",
                error: (error as Error).message,
                requestId:
                  error instanceof ApiError ? error.requestId : undefined,
              }));
            }
          } finally {
            controller = null;
            set({ streaming: false });
          }
        },

        stop() {
          controller?.abort();
        },

        reset() {
          controller?.abort();
          set({ messages: [] });
        },

        setModel: (model) => set({ model }),
        setPromptId: (promptId) => set({ promptId }),
      };
    },
    {
      name: "ia-local-chat",
      partialize: (s) => ({
        messages: s.messages,
        model: s.model,
        promptId: s.promptId,
      }),
      // A reload mid-answer leaves the stream behind; do not show it as live.
      merge: (persisted, current) => {
        const saved = persisted as Partial<ChatState> | undefined;
        return {
          ...current,
          ...saved,
          messages: (saved?.messages ?? []).map((m) =>
            m.status === "streaming" ? { ...m, status: "stopped" } : m,
          ),
        };
      },
    },
  ),
);
