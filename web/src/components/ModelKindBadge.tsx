import { Brain, Zap } from "lucide-react";
import type { ModelInfo } from "@ia-local/sdk";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Icon and label only, for places that cannot host a tooltip (a Select item). */
export function ModelKindLabel({
  info,
  className,
}: {
  info: Pick<ModelInfo, "reasoning">;
  className?: string;
}) {
  const Icon = info.reasoning ? Brain : Zap;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        info.reasoning ? "text-thinking" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" />
      {info.reasoning ? "Thinks" : "Direct"}
    </span>
  );
}

/**
 * What kind of model this is, with a tooltip on when each kind is the right
 * pick. The classification comes from the server (familyOf in
 * src/harness.ts), so the UI and the harness never disagree.
 */
export function ModelKindBadge({ info }: { info: ModelInfo }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1",
            info.reasoning && "border-thinking/40 text-thinking",
          )}
        >
          {info.reasoning ? <Brain /> : <Zap />}
          {info.reasoning ? "Reasoning model" : "Chat model"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1.5">
        {info.reasoning ? (
          <>
            <p>
              <strong>Thinks before answering.</strong> Slower, and every answer
              spends part of the token budget on reasoning.
            </p>
            <p>
              Use it for math, code, logic and multi-step problems. For quick
              chat, translation or rewording, a chat model is faster.
            </p>
            {!info.supportsSystem && (
              <p>
                This one takes no system role: the prompt is folded into your
                message.
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              <strong>Answers directly</strong>, with no thinking step. Fast.
            </p>
            <p>
              Use it for chat, translation, summaries and rewording. For hard
              math or code, load a reasoning model (e.g. DeepSeek R1).
            </p>
          </>
        )}
        <p className="font-mono opacity-70">family: {info.family}</p>
      </TooltipContent>
    </Tooltip>
  );
}
