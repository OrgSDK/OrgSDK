"use client";
import { type ReactNode } from "react";
import { Credentials } from "../../../components/workspace/credentials";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { canManage, setDirty } = useWorkspace();
  return <Credentials canManage={canManage} onDirtyChange={setDirty} />;
}
