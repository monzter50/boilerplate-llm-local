import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collect,
  everyCut,
  fakeCompletionStream,
  type FakeDelta,
} from "../test/utils/index.js";
import { chat, chatStream, client, splitThinking } from "./llm.js";
import { joinChunks } from "./think.js";

const R1 = "deepseek-r1-distill-qwen-7b";
const CHAT = "qwen2.5-7b-instruct";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs chatStream over these deltas, as if LM Studio had sent them. */
async function streamed(model: string, deltas: FakeDelta[]) {
  vi.spyOn(client.chat.completions, "create").mockResolvedValue(
    fakeCompletionStream(deltas) as never,
  );
  const chunks = await collect(
    chatStream([{ role: "user", content: "hi" }], { model }),
  );
  return { chunks, ...joinChunks(chunks) };
}

const contents = (...parts: string[]): FakeDelta[] =>
  parts.map((content) => ({ content }));

describe("splitThinking", () => {
  it("is a no-op when there are no tags", () => {
    expect(splitThinking("just the answer")).toEqual({
      thinking: "",
      answer: "just the answer",
    });
  });

  it("pulls inline <think> out of the content", () => {
    expect(splitThinking("<think>hmm</think>the answer")).toEqual({
      thinking: "hmm",
      answer: "the answer",
    });
  });

  it("handles reasoning that spans several lines", () => {
    const raw = "<think>first\n\nsecond</think>\n\nthe answer";
    expect(splitThinking(raw)).toEqual({
      thinking: "first\n\nsecond",
      answer: "the answer",
    });
  });

  it("returns an empty answer when the model only produced reasoning", () => {
    expect(splitThinking("<think>ran out of budget</think>")).toEqual({
      thinking: "ran out of budget",
      answer: "",
    });
  });

  it("handles a missing <think> when the template injected it", () => {
    expect(
      splitThinking("hmm, let me see</think>\n\nthe answer", {
        reasoningModel: true,
      }),
    ).toEqual({ thinking: "hmm, let me see", answer: "the answer" });
  });

  it("keeps reasoning out of the answer when </think> never came", () => {
    expect(
      splitThinking("<think>still thinking when the budget ran", {
        truncated: true,
      }),
    ).toEqual({ thinking: "still thinking when the budget ran", answer: "" });
    expect(
      splitThinking("no opening tag and cut off", {
        reasoningModel: true,
        truncated: true,
      }),
    ).toEqual({ thinking: "no opening tag and cut off", answer: "" });
  });

  it("does not take a plain answer from a reasoning model for reasoning", () => {
    // No </think>, not truncated: nothing says this was ever reasoning.
    expect(splitThinking("just the answer", { reasoningModel: true })).toEqual({
      thinking: "",
      answer: "just the answer",
    });
  });

  it("leaves tags mentioned inside an answer alone", () => {
    const raw = "Wrap it in <think> and </think> tags.";
    expect(splitThinking(raw)).toEqual({ thinking: "", answer: raw });
  });
});

describe("chatStream inline <think>", () => {
  it("splits tags that arrive split across chunks", async () => {
    const raw = "<think>hmm</think>\n\nthe answer";

    // Cutting at every position covers "<thi" + "nk>" and "</th" + "ink>".
    for (const [a, b] of everyCut(raw)) {
      const { thinking, answer } = await streamed(CHAT, contents(a, b));
      expect({ thinking, answer }, `cut: ${JSON.stringify([a, b])}`).toEqual({
        thinking: "hmm",
        answer: "the answer",
      });
    }
  });

  it("splits a tag sent one character per chunk", async () => {
    const raw = "<think>a b</think>c d";
    const { thinking, answer } = await streamed(CHAT, contents(...raw));
    expect({ thinking, answer }).toEqual({ thinking: "a b", answer: "c d" });
  });

  it("streams reasoning as it arrives, not all at the end", async () => {
    const { chunks } = await streamed(
      CHAT,
      contents("<think>one ", "two ", "three</think>", "answer"),
    );
    expect(chunks.filter((c) => c.kind === "reasoning").length).toBe(3);
  });

  it("treats output without <think> as reasoning for a reasoning model", async () => {
    const { thinking, answer } = await streamed(
      R1,
      contents("hmm, the user", " wants X</th", "ink>\n\nX."),
    );
    expect({ thinking, answer }).toEqual({
      thinking: "hmm, the user wants X",
      answer: "X.",
    });
  });

  it("keeps a truncated stream's reasoning out of the answer", async () => {
    // finish_reason "length": the closing tag never arrives.
    const opened = await streamed(CHAT, contents("<think>still go", "ing</"));
    expect(opened).toMatchObject({ thinking: "still going</", answer: "" });

    const implicit = await streamed(R1, contents("no opening tag, cut off"));
    expect(implicit).toMatchObject({
      thinking: "no opening tag, cut off",
      answer: "",
    });
  });

  it("leaves a chat model's answer alone, tags it mentions included", async () => {
    const { thinking, answer } = await streamed(
      CHAT,
      contents("Use <thi", "nk> tags", " like </think>."),
    );
    expect({ thinking, answer }).toEqual({
      thinking: "",
      answer: "Use <think> tags like </think>.",
    });
  });

  it("passes content through when the server parses reasoning itself", async () => {
    // LM Studio with reasoning parsing on: content is already pure answer, even
    // for a reasoning model whose answer happens to contain </think>.
    const { thinking, answer } = await streamed(R1, [
      { reasoning_content: "hmm" },
      { content: "Close it with </think>." },
    ]);
    expect({ thinking, answer }).toEqual({
      thinking: "hmm",
      answer: "Close it with </think>.",
    });
  });
});

describe("retries", () => {
  it("never retries a generation, so a timeout is not paid twice", async () => {
    const create = vi
      .spyOn(client.chat.completions, "create")
      .mockResolvedValueOnce({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      } as never)
      .mockResolvedValueOnce(fakeCompletionStream(contents("hi")) as never);

    await chat([{ role: "user", content: "hi" }], { model: CHAT });
    await collect(
      chatStream([{ role: "user", content: "hi" }], { model: CHAT }),
    );

    for (const call of create.mock.calls) {
      expect(call[1]).toMatchObject({ maxRetries: 0 });
    }
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("keeps the client default for cheap calls such as models.list", () => {
    // MAX_RETRIES is unset in the test env, so the default of 1 applies.
    expect(client.maxRetries).toBe(1);
  });
});
