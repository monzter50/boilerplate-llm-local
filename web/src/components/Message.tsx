import { useState } from "react";
import { AlertCircle, Brain, ChevronRight, Loader2 } from "lucide-react";
import type { UiMessage } from "@/store";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

function Reasoning({ message }: { message: UiMessage }) {
  // Open while the model is still thinking, closed once the answer starts;
  // after that the user decides.
  const thinking = message.status === "streaming" && !message.content;
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? thinking;

  return (
    <Collapsible open={open} onOpenChange={setUserOpen} className="mb-2">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        <Brain className="size-3.5" />
        {thinking ? "Thinking…" : "Reasoning"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-2 border-l-2 pl-3 text-xs whitespace-pre-wrap text-muted-foreground">
          {message.reasoning}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Message({ message }: { message: UiMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2 whitespace-pre-wrap text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const waiting =
    message.status === "streaming" && !message.content && !message.reasoning;
  // Reasoning models can spend the whole token budget thinking (see README).
  const empty = message.status === "done" && !message.content;

  return (
    <div className="max-w-[85%]">
      {message.reasoning && <Reasoning message={message} />}

      {waiting && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}

      {message.content && (
        <div className="whitespace-pre-wrap">{message.content}</div>
      )}

      {message.status === "stopped" && (
        <p className="mt-1 text-xs text-muted-foreground">Stopped.</p>
      )}

      {empty && (
        <Alert className="mt-2">
          <AlertCircle />
          <AlertTitle>No answer</AlertTitle>
          <AlertDescription>
            The model finished without writing an answer. Reasoning models can
            spend the whole token budget thinking; raise MAX_TOKENS on the
            server.
          </AlertDescription>
        </Alert>
      )}

      {message.status === "error" && (
        <Alert variant="destructive" className="mt-2">
          <AlertCircle />
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>
            <p>{message.error}</p>
            {message.requestId && (
              <p className="font-mono text-xs">
                request id: {message.requestId}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
