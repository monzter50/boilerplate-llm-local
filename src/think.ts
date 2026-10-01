import type { ChatChunk } from "./llm.js";

const OPEN = "<think>";
const CLOSE = "</think>";

/**
 * Length of the longest suffix of `text` that is a proper prefix of `tag`:
 * the bytes to hold back because the tag may finish in the next chunk.
 */
function partialTagAtEnd(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

export type ThinkSplitterOptions = {
  /**
   * Treat output that does not open with <think> as reasoning anyway, until a
   * </think> shows up. Right for R1-style models: many chat templates inject
   * the opening tag into the prompt, so the output starts mid-thought and only
   * carries the closing tag.
   */
  implicitThinking?: boolean;
};

/**
 * Splits inline <think>...</think> out of streamed `content`, for servers that
 * do not parse reasoning into its own field. Incremental, because a tag can
 * arrive split across chunks ("<thi" + "nk>"), so a regex per chunk cannot see
 * it.
 *
 * Only an opening tag at the very start counts, and only while thinking does a
 * closing tag count: an answer that talks about <think> tags keeps them as
 * text.
 */
export class ThinkSplitter {
  private state: "start" | "thinking" | "answer" = "start";
  /** Text held back until it is known which side of a tag it belongs to. */
  private pending = "";
  /** Drops the blank lines models put between </think> and the answer. */
  private trimAnswerStart = false;
  private readonly implicitThinking: boolean;

  constructor(options: ThinkSplitterOptions = {}) {
    this.implicitThinking = options.implicitThinking ?? false;
  }

  push(text: string): ChatChunk[] {
    const out: ChatChunk[] = [];
    this.pending += text;

    if (this.state === "start") {
      const head = this.pending.trimStart();
      // Leading whitespace, or the start of what may become "<think>".
      if (head === "" || (head.length < OPEN.length && OPEN.startsWith(head))) {
        return out;
      }
      if (head.startsWith(OPEN)) {
        this.state = "thinking";
        this.pending = head.slice(OPEN.length);
      } else {
        this.state = this.implicitThinking ? "thinking" : "answer";
      }
    }

    if (this.state === "thinking") {
      const close = this.pending.indexOf(CLOSE);
      if (close === -1) {
        const keep = partialTagAtEnd(this.pending, CLOSE);
        emit(
          out,
          "reasoning",
          this.pending.slice(0, this.pending.length - keep),
        );
        this.pending = this.pending.slice(this.pending.length - keep);
        return out;
      }
      emit(out, "reasoning", this.pending.slice(0, close));
      this.pending = this.pending.slice(close + CLOSE.length);
      this.state = "answer";
      this.trimAnswerStart = true;
    }

    // state === "answer"
    let answer = this.pending;
    this.pending = "";
    if (this.trimAnswerStart) {
      answer = answer.trimStart();
      // Still only whitespace: keep trimming whatever comes next.
      if (answer) this.trimAnswerStart = false;
    }
    emit(out, "content", answer);
    return out;
  }

  /**
   * Flushes what was held back. A stream cut short (finish_reason "length")
   * never sends </think>, so whatever is pending is still reasoning.
   */
  end(): ChatChunk[] {
    const out: ChatChunk[] = [];
    const rest = this.pending;
    this.pending = "";

    if (this.state === "thinking") {
      emit(out, "reasoning", rest);
    } else if (this.state === "start") {
      // Only whitespace or a lone "<thi" ever arrived.
      emit(
        out,
        this.implicitThinking ? "reasoning" : "content",
        rest.trim() ? rest : "",
      );
    }
    return out;
  }
}

function emit(out: ChatChunk[], kind: ChatChunk["kind"], text: string): void {
  if (text) out.push({ kind, text });
}

/** Folds chunks back into whole strings. */
export function joinChunks(chunks: ChatChunk[]): {
  thinking: string;
  answer: string;
} {
  let thinking = "";
  let answer = "";
  for (const chunk of chunks) {
    if (chunk.kind === "reasoning") thinking += chunk.text;
    else answer += chunk.text;
  }
  return { thinking: thinking.trim(), answer: answer.trim() };
}

/**
 * Splits inline <think> out of a complete `content`. A no-op when there are no
 * tags. Unlike a stream, the whole text is known, so implicit thinking is only
 * assumed when there is evidence of it: a </think>, or a cut-off answer.
 */
export function splitThinking(
  text: string,
  options: { reasoningModel?: boolean; truncated?: boolean } = {},
): { thinking: string; answer: string } {
  const implicitThinking =
    (options.reasoningModel ?? false) &&
    (text.includes(CLOSE) || (options.truncated ?? false));

  const splitter = new ThinkSplitter({ implicitThinking });
  return joinChunks([...splitter.push(text), ...splitter.end()]);
}
