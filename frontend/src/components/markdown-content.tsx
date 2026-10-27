import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utilities";

interface MarkdownContentProperties {
  content: string;
  className?: string;
}

export function MarkdownContent({
  content,
  className,
}: MarkdownContentProperties): React.ReactNode {
  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
