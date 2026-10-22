"use client";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useWorkspace } from "./workspace-context";
export function WorkspaceLink({
  href,
  children,
  onNavigate,
  ...properties
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }): ReactNode {
  const { isDirty, navigateTo } = useWorkspace();
  return (
    <Link
      href={href}
      {...properties}
      onNavigate={(event) => {
        onNavigate?.(event);
        if (!isDirty) return;
        event.preventDefault();
        void navigateTo(href);
      }}
    >
      {children}
    </Link>
  );
}
