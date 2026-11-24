import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utilities";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        secondary: "bg-slate-100 text-slate-700",
        success: "bg-emerald-50 text-emerald-800",
        warning: "bg-amber-50 text-amber-800",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export function Badge({
  variant,
  className,
  ...properties
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>): ReactNode {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...properties}
    />
  );
}
