"use client";
import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ActionScope } from "../../../components/workspace/action-navigation";
import { Runs } from "../../../components/runs";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <Content />
    </Suspense>
  );
}
function Content(): ReactNode {
  const { agents, selected: project, navigateTo } = useWorkspace();
  const parameters = useSearchParams();
  return (
    <ActionScope current="runs">
      {(actionId) => (
        <Runs
          key={`${project}:${actionId}`}
          agents={agents}
          actionId={actionId}
          selected={parameters.get("run") ?? ""}
          onSelect={(run) => {
            const query = new URLSearchParams({ project });
            if (actionId) query.set("action", actionId);
            if (run) query.set("run", run);
            void navigateTo(`/runs/?${query.toString()}`);
          }}
        />
      )}
    </ActionScope>
  );
}
