import { useEffect, useState } from "react";
import { RefreshCw, SquarePen } from "lucide-react";
import type { HealthResponse, ModelInfo } from "@ia-local/sdk";
import { useShallow } from "zustand/react/shallow";
import { api } from "@/api";
import { useChat } from "@/store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ModelKindBadge, ModelKindLabel } from "./ModelKindBadge";
import { ThemeToggle } from "./ThemeToggle";

const HEALTH_POLL_MS = 15_000;

// Radix Select cannot hold an empty value, so "use the server's default" needs
// a sentinel of its own.
const DEFAULT = "__default";

type Status = { health: HealthResponse; models?: ModelInfo[] };

/** Health, plus the model list when LM Studio is up. Never throws. */
async function fetchStatus(): Promise<Status> {
  try {
    const health = await api.health();
    if (health.status !== "ok") return { health };
    return { health, models: await api.modelDetails() };
  } catch (error) {
    // The API itself is down, not just LM Studio.
    return {
      health: {
        status: "unavailable",
        error: `API unreachable: ${(error as Error).message}`,
      },
    };
  }
}

export function Header() {
  const { model, promptId, setModel, setPromptId, reset, streaming } = useChat(
    useShallow((s) => ({
      model: s.model,
      promptId: s.promptId,
      setModel: s.setModel,
      setPromptId: s.setPromptId,
      reset: s.reset,
      streaming: s.streaming,
    })),
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  function apply({ health, models }: Status) {
    setHealth(health);
    if (models) setModels(models);
  }

  useEffect(() => {
    // Late responses after unmount (or a StrictMode remount) are dropped.
    let active = true;
    const poll = () =>
      fetchStatus().then((status) => {
        if (active) apply(status);
      });

    void poll();
    api.prompts().then(
      (list) => active && setPrompts(list),
      () => {},
    );
    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await api.refreshModel();
    } catch {
      // fetchStatus() below reports whatever is wrong through the badge.
    }
    apply(await fetchStatus());
    setRefreshing(false);
  }

  const ok = health?.status === "ok";
  const serverInfo = health?.status === "ok" ? health.info : undefined;
  const serverModel = serverInfo?.id;
  // The model the next message goes to: the picked one, or the server's.
  const activeInfo = model ? models.find((m) => m.id === model) : serverInfo;

  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <h1 className="mr-2 font-semibold">IA-local</h1>

      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1.5">
            <span
              className={cn(
                "size-2 rounded-full",
                health === null
                  ? "bg-muted-foreground"
                  : ok
                    ? "bg-success"
                    : "bg-destructive",
              )}
            />
            {health === null ? "checking" : ok ? "online" : "offline"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {health?.status === "ok"
            ? `LM Studio at ${health.baseURL}`
            : (health?.error ?? "Checking the API…")}
        </TooltipContent>
      </Tooltip>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select
          value={model ?? DEFAULT}
          onValueChange={(v) => setModel(v === DEFAULT ? undefined : v)}
        >
          <SelectTrigger size="sm" className="w-64" aria-label="Model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>
              Server default{serverModel ? ` (${serverModel})` : ""}
            </SelectItem>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.id}
                <ModelKindLabel info={m} className="ml-1.5" />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Re-read models from LM Studio"
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Re-read models from LM Studio</TooltipContent>
        </Tooltip>

        {activeInfo && <ModelKindBadge info={activeInfo} />}

        <Select
          value={promptId ?? DEFAULT}
          onValueChange={(v) => setPromptId(v === DEFAULT ? undefined : v)}
        >
          <SelectTrigger size="sm" className="w-36" aria-label="Prompt">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Default prompt</SelectItem>
            {prompts.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          disabled={streaming}
        >
          <SquarePen />
          New chat
        </Button>

        <ThemeToggle />
      </div>
    </header>
  );
}
