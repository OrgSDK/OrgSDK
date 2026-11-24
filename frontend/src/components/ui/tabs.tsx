"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utilities";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...properties
}: ComponentProps<typeof TabsPrimitive.List>): ReactNode {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex min-w-0 items-stretch overflow-x-auto bg-slate-50",
        className,
      )}
      {...properties}
    />
  );
}

export function TabsTrigger({
  className,
  ...properties
}: ComponentProps<typeof TabsPrimitive.Trigger>): ReactNode {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-xs font-medium text-slate-600 data-[state=active]:border-indigo-600 data-[state=active]:bg-white data-[state=active]:text-slate-950 focus-visible:outline-offset-[-3px]",
        className,
      )}
      {...properties}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
