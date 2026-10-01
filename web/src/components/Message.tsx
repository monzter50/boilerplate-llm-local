import { lazy, Suspense, useState } from "react";
import { AlertCircle, Brain, ChevronRight, Loader2, Zap } from "lucide-react";
import type { UiMessage } from "@/store";
import { cn } from "@/lib/utils";

// Markdown, GFM and syntax highlighting roughly double the bundle, so they
// load as their own chunk. Until it arrives, answers show as plain text.
const Markdown = lazy(() =>
  import("./Markdown").then((m) => ({ default: m.Markdown })),
);
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** Whether this answer went through a thinking step, and which model gave it. */
function AnswerBadges({ message }: { message: UiMessage }) {
  const { modelInfo, reasoning, thinkingMs, status } = message;
  const thought = reasoning.length > 0;

  let think: { label: string; hint: string } | null = null;
  if (thought && thinkingMs !== undefined) {
    think = {
      label: `Thought for ${formatDuration(thinkingMs)}`,
      hint: "The model reasoned before answering. Open the Reasoning panel above to read it.",
    };
  } else if (!thought && status === "done" && modelInfo) {
    think = modelInfo.reasoning
      ? {
          label: "Skipped thinking",
          hint: "A reasoning model, but it answered without a thinking step this time.",
        }
      : {
          label: "No thinking",
          hint: "A chat model: it answers directly, with no thinking step.",
        };
  }

  if (!think && !modelInfo) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {think && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn(
                "gap-1 font-normal",
                thought
                  ? "border-thinking/40 text-thinking"
                  : "text-muted-foreground",
              )}
            >
              {thought ? <Brain /> : <Zap />}
              {think.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{think.hint}</TooltipContent>
        </Tooltip>
      )}
      {modelInfo && (
        <Badge
          variant="outline"
          className="font-mono font-normal text-muted-foreground"
        >
          {modelInfo.id}
        </Badge>
      )}
    </div>
  );
}

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
        <Suspense
          fallback={
            <div className="whitespace-pre-wrap">{message.content}</div>
          }
        >
          <Markdown text={message.content} />
        </Suspense>
      )}

      <AnswerBadges message={message} />

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
