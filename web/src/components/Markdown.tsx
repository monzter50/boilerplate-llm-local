import {
  isValidElement,
  memo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "language-ts hljs" → "ts", from the <code> element inside a <pre>. */
function languageOf(children: ReactNode): string | undefined {
  if (!isValidElement<{ className?: string }>(children)) return undefined;
  return /language-([\w-]+)/.exec(children.props.className ?? "")?.[1];
}

function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const language = languageOf(children);

  async function copy() {
    // textContent, not the markdown source: what is shown is what is copied.
    await navigator.clipboard.writeText(ref.current?.textContent ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="not-prose my-3 overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span className="font-mono">{language ?? "text"}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        ref={ref}
        {...props}
        className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  // Model output can contain any link: open it away from the chat, and send no
  // referrer or window handle along.
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  // Wide tables scroll inside the bubble instead of stretching the page.
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

/**
 * Renders a model answer as GitHub-flavored markdown, with syntax-highlighted
 * code blocks. Raw HTML in the text is shown as text, never rendered, so model
 * output cannot inject markup into the page.
 *
 * Memoized on the text: while one answer streams, earlier messages do not
 * re-parse on every token.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert prose-headings:font-semibold prose-code:before:content-none prose-code:after:content-none prose-pre:p-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
