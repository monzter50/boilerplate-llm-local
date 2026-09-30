import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ApiError, type ChatMessage } from "@ia-local/sdk";
import { api } from "./api";

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

          try {
            const stream = api.chatStream(
              { messages: toHistory(messages), model, promptId },
              { signal: controller.signal },
            );
            for await (const chunk of stream) {
              patch(reply.id, (m) =>
                chunk.kind === "content"
                  ? { content: m.content + chunk.text }
                  : { reasoning: m.reasoning + chunk.text },
              );
            }
            patch(reply.id, () => ({ status: "done" }));
          } catch (error) {
            if ((error as Error).name === "AbortError") {
              patch(reply.id, () => ({ status: "stopped" }));
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
