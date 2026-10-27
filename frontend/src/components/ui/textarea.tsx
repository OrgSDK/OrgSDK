import * as React from "react";
import { cn } from "../../lib/utilities";

export type TextareaProperties =
  React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProperties>(
  ({ className, ...properties }, reference) => (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={reference}
      {...properties}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
