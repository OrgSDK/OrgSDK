"use client";
import type { ReactNode } from "react";
import { ApprovalQueue } from "../../../components/workspace/approval-queue";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { openRun } = useWorkspace();
  return <ApprovalQueue openRun={openRun} />;
}
