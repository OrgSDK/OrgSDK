"use client";

import { Cable, Code2, Plus, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { loadActions } from "../../api/workspace-queries";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ActionCard } from "./action-card";
import { PageHeader } from "./page-header";
import { ResourceState } from "./resource-state";
import { useWorkspace } from "./workspace-context";
import { WorkspaceLink } from "./workspace-link";

export function ActionIndex(): ReactNode {
  const { agents, selected: projectId } = useWorkspace();
  const project = agents.find((item) => item.id === projectId);
  const query = useWorkspaceQuery(loadActions);
  const [search, setSearch] = useState("");
  if (!project) {
    return (
      <section className="panel space-y-4">
        <PageHeader>
          <strong>Actions</strong>
        </PageHeader>
        <h1>Actions</h1>
        <p>
          Create a project to give your MCP client a place to build and run
          saved actions.
        </p>
        <Button asChild>
          <WorkspaceLink href="/projects/?new=1">Create project</WorkspaceLink>
        </Button>
      </section>
    );
  }
  const actions = (query.data ?? []).filter(
    (action) => (action.project ?? action.agent) === projectId,
  );
  const searchText = search.trim().toLowerCase();
  const matching = actions.filter((action) =>
    `${action.name} ${action.description ?? ""}`
      .toLowerCase()
      .includes(searchText),
  );
  const projectQuery = new URLSearchParams({ project: projectId }).toString();

  return (
    <div className="space-y-6">
      <PageHeader>
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <WorkspaceLink
            href={`/projects/?${projectQuery}`}
            className="truncate"
          >
            {project.name}
          </WorkspaceLink>
          <span aria-hidden="true" className="text-slate-300">
            /
          </span>
          <strong>Actions</strong>
        </div>
      </PageHeader>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">{project.name}</p>
          <h1>Actions</h1>
          <p>Build what your connected MCP client can run in this project.</p>
        </div>
        <Button asChild>
          <WorkspaceLink href={`/actions/?${projectQuery}&new=1`}>
            <Plus size={16} aria-hidden="true" /> New action
          </WorkspaceLink>
        </Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
        <div className="flex items-start gap-3">
          <Cable
            size={20}
            className="mt-0.5 shrink-0 text-indigo-600"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900">
              Built with your MCP client
            </p>
            <p className="text-sm">
              Save reusable actions, inspect their runs, then add schedules or
              webhooks.
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <WorkspaceLink href={`/connections/?${projectQuery}`}>
            Connect client
          </WorkspaceLink>
        </Button>
      </div>

      <ResourceState {...query} />
      {query.data && actions.length > 0 ? (
        <section className="space-y-4" aria-label="Saved actions">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {actions.length} saved{" "}
              {actions.length === 1 ? "action" : "actions"}
            </p>
            <label className="relative block w-full sm:max-w-xs">
              <span className="sr-only">Search actions</span>
              <Search
                size={16}
                className="absolute top-2.5 left-3 text-slate-400"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                placeholder="Search actions"
                className="pl-9!"
              />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {matching.map((action) => (
              <ActionCard key={action.id} action={action} />
            ))}
          </div>
          {matching.length === 0 ? (
            <p role="status">No actions match “{search}”.</p>
          ) : null}
        </section>
      ) : null}
      {!query.isLoading && !query.error && actions.length === 0 ? (
        <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-slate-300 bg-white p-6">
          <Code2 size={24} className="text-indigo-600" aria-hidden="true" />
          <h2 className="mb-0!">No saved actions yet</h2>
          <p>
            Ask your connected MCP client to create an action, or start one
            here. Each action keeps its code versions, runs, schedules and
            webhooks together.
          </p>
          <Button variant="outline" asChild>
            <WorkspaceLink href={`/actions/?${projectQuery}&new=1`}>
              Create an action
            </WorkspaceLink>
          </Button>
        </section>
      ) : null}
    </div>
  );
}
