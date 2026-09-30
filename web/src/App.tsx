import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "@/components/Composer";
import { Header } from "@/components/Header";
import { MessageList } from "@/components/MessageList";

export function App() {
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <Header />
        <MessageList />
        <Composer />
      </div>
    </TooltipProvider>
  );
}
