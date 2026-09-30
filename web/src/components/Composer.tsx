import { useState, type FormEvent, type KeyboardEvent } from "react";
import { SendHorizontal, Square } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useChat } from "@/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer() {
  const { send, stop, streaming } = useChat(
    useShallow((s) => ({ send: s.send, stop: s.stop, streaming: s.streaming })),
  );
  const [text, setText] = useState("");

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (streaming || !text.trim()) return;
    void send(text);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line. isComposing keeps Enter from
    // sending while an IME (Japanese, Chinese…) is still composing a word.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      submit(event);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 pb-4"
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Message the model…  (Shift+Enter for a new line)"
        className="max-h-48 min-h-11 resize-none"
        rows={1}
        autoFocus
      />
      {streaming ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={stop}
          aria-label="Stop generating"
        >
          <Square />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim()}
          aria-label="Send"
        >
          <SendHorizontal />
        </Button>
      )}
    </form>
  );
}
