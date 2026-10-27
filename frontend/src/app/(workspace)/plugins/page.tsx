"use client";
import { type ReactNode } from "react";
import { Plugins } from "../../../components/workspace/plugins";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { canManage, setDirty, selected } = useWorkspace();
  return (
    <Plugins key={selected} canManage={canManage} onDirtyChange={setDirty} />
  );
}
