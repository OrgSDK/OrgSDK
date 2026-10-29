"use client";
import type { ReactNode } from "react";
import { Webhooks } from "../../../components/workspace/webhooks";
import { ActionScope } from "../../../components/workspace/action-navigation";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  const { selected } = useWorkspace();
  return (
    <ActionScope current="webhooks">
      {(actionId) => (
        <Webhooks key={`${selected}:${actionId}`} actionId={actionId} />
      )}
    </ActionScope>
  );
}
