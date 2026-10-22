"use client";
import { type ReactNode } from "react";
import { Members } from "../../../components/members";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { refresh } = useWorkspace();
  return <Members onChanged={refresh} />;
}
