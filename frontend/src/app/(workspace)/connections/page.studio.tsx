"use client";
import type { ReactNode } from "react";
import { Connections } from "../../../components/connections";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { canManage, goTo, selected } = useWorkspace();
  return <Connections key={selected} canManage={canManage} navigate={goTo} />;
}
