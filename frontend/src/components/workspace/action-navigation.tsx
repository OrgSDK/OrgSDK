"use client";
import type { Action } from "../../api/types";
import { useCallback, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { trpc } from "../../api/trpc";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { useWorkspace } from "./workspace-context";
import { WorkspaceLink } from "./workspace-link";
import { ResourceState } from "./resource-state";

const sections = [
  { id: "editor", label: "Code & configuration", path: "/actions/" },
  { id: "runs", label: "Runs", path: "/runs/" },
  { id: "schedules", label: "Schedule", path: "/schedules/" },
  { id: "webhooks", label: "Webhooks", path: "/webhooks/" },
] as const;
type Section = (typeof sections)[number]["id"];

export function ActionNavigation({
  action,
  current,
}: {
  action: Action;
  current: Section;
}): ReactNode {
  const project = action.project;
  const parameters = new URLSearchParams({ project, action: action.id });
  return (
    <div className="mb-6 min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <WorkspaceLink
          className="inline-flex items-center gap-1 text-sm"
          href={`/actions/?${new URLSearchParams({ project }).toString()}`}
        >
          <ArrowLeft size={14} aria-hidden="true" /> All actions
        </WorkspaceLink>
        <span className="text-slate-300" aria-hidden="true">
          /
        </span>
        <strong className="min-w-0 break-words">{action.name}</strong>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Action sections">
        {sections.map((section) => (
          <WorkspaceLink
            key={section.id}
            href={`${section.path}?${parameters.toString()}`}
            aria-current={current === section.id ? "page" : undefined}
            className={
              current === section.id
                ? "rounded-md bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700"
                : "rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            }
          >
            {section.label}
          </WorkspaceLink>
        ))}
      </nav>
    </div>
  );
}

export function ActionScope({
  current,
  children,
}: {
  current: Section;
  children: (actionId: string) => ReactNode;
}): ReactNode {
  const { selected: project } = useWorkspace();
  const parameters = useSearchParams();
  const actionId = parameters.get("action") ?? "";
  return (
    <ScopedAction
      key={`${project}:${actionId}`}
      project={project}
      actionId={actionId}
      current={current}
    >
      {children}
    </ScopedAction>
  );
}

function ScopedAction({
  project,
  actionId,
  current,
  children,
}: {
  project: string;
  actionId: string;
  current: Section;
  children: (actionId: string) => ReactNode;
}): ReactNode {
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!actionId) return;
      const action = await trpc.actions.get.query({ id: actionId }, { signal });
      if (action.project !== project)
        throw new Error(
          "This action is not available in the selected project.",
        );
      return action;
    },
    [actionId, project],
  );
  const query = useWorkspaceQuery(load);
  if (
    actionId &&
    (query.isLoading || query.error || query.data?.id !== actionId)
  )
    return <ResourceState {...query} />;
  return (
    <>
      {query.data ? (
        <ActionNavigation action={query.data} current={current} />
      ) : (
        <p className="mb-5">
          <WorkspaceLink
            href={`/actions/?${new URLSearchParams({ project }).toString()}`}
          >
            Back to project actions
          </WorkspaceLink>
        </p>
      )}
      {children(actionId)}
    </>
  );
}
