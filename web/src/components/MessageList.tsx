import { useEffect, useRef } from "react";
import { MessagesSquare } from "lucide-react";
import { useChat } from "@/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Message } from "./Message";

export function MessageList() {
  const messages = useChat((s) => s.messages);
  const bottom = useRef<HTMLDivElement>(null);

  // Follow the answer as it streams in.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <MessagesSquare className="size-8" />
        <p>Ask anything. It runs on your machine.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        <div ref={bottom} />
      </div>
    </ScrollArea>
  );
}
