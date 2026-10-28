"use client";
import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Actions } from "../../../components/workspace/actions";
import { ActionIndex } from "../../../components/workspace/action-index";
import { useWorkspace } from "../../../components/workspace/workspace-context";
export default function Page(): ReactNode {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <Content />
    </Suspense>
  );
}
function Content(): ReactNode {
  const {
    projects,
    selected: projectId,
    setDirty,
    navigateTo,
  } = useWorkspace();
  const parameters = useSearchParams();
  const selectedId = parameters.get("action") ?? "";
  const isCreating = parameters.get("new") === "1";
  if (!selectedId && !isCreating) return <ActionIndex key={projectId} />;
  return (
    <Actions
      key={selectedId}
      projects={projects}
      onDirtyChange={setDirty}
      selectedId={selectedId}
      onSelect={(id) => {
        const query = new URLSearchParams({ project: projectId });
        if (id) query.set("action", id);
        else query.set("new", "1");
        void navigateTo(`/actions/?${query.toString()}`);
      }}
    />
  );
}
