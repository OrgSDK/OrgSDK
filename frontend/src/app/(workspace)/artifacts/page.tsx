"use client";
import type { ReactNode } from "react";
import { Artifacts } from "../../../components/workspace/artifacts";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { openRun } = useWorkspace();
  return <Artifacts openRun={openRun} />;
}
