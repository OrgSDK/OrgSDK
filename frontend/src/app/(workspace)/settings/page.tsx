"use client";
import { type ReactNode } from "react";
import { Settings } from "../../../components/workspace/settings";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { workspace, role, goTo, refresh } = useWorkspace();
  return (
    <Settings
      workspace={workspace}
      role={role}
      navigate={goTo}
      refreshWorkspace={refresh}
    />
  );
}
