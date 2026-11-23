"use client";
import type { ReactNode } from "react";
import { Overview } from "../../components/workspace/overview";
import { useWorkspace } from "../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { goTo, openRun } = useWorkspace();
  return <Overview navigate={goTo} openRun={openRun} />;
}
