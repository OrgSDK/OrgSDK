"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const PageHeaderContext = createContext<HTMLDivElement | null>(null);

export function PageHeader({ children }: { children: ReactNode }): ReactNode {
  const container = useContext(PageHeaderContext);
  return container ? createPortal(children, container) : null;
}
