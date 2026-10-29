"use client";
import type { ReactNode } from "react";
import { Schedules } from "../../../components/workspace/schedules";
import { ActionScope } from "../../../components/workspace/action-navigation";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { selected } = useWorkspace();
  return (
    <ActionScope current="schedules">
      {(actionId) => (
        <Schedules key={`${selected}:${actionId}`} actionId={actionId} />
      )}
    </ActionScope>
  );
}
