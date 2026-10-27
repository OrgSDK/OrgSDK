"use client";
import { useState, type ReactNode } from "react";
import { api } from "../api/client";
import { errorMessage, result, requireSuccess } from "../api/result";
import type { components } from "../api/schema";
import {
  loadDocuments,
  loadPlugins,
  loadRuns,
  loadActions,
} from "../api/workspace-queries";
import { useWorkspaceQuery } from "../api/use-workspace-query";
import { ActionCard } from "./workspace/action-card";
import { AgentRunner } from "./workspace/agent-runner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useUnsavedChanges } from "./workspace/use-unsaved-changes";
import { useDiscardConfirmation } from "./workspace/discard-dialog";
import { useWorkspace } from "./workspace/workspace-context";
import { WorkspaceLink } from "./workspace/workspace-link";
import { ResourceState } from "./workspace/resource-state";

type Project = components["schemas"]["Project"];
type ProjectTab = "overview" | "access" | "runner" | "settings";
const projectTabs: { id: ProjectTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "access", label: "Data access" },
  { id: "runner", label: "Runner" },
  { id: "settings", label: "Settings" },
];
const grantFields = [
  { field: "readable_tables", label: "Read tables", resource: "tables" },
  { field: "writable_tables", label: "Write tables", resource: "tables" },
  {
    field: "readable_documents",
    label: "Read documents",
    resource: "documents",
  },
  {
    field: "writable_documents",
    label: "Write documents",
    resource: "documents",
  },
] as const;
async function loadProjectActivity(signal: AbortSignal) {
  const [runs, actions] = await Promise.all([
    loadRuns(signal),
    loadActions(signal),
  ]);
  return { runs, actions };
}
async function loadProjectAccess(signal: AbortSignal) {
  const [plugins, documents, firstTables] = await Promise.all([
    loadPlugins(signal),
    loadDocuments(signal),
    (async () => result(await api.GET("/api/v1/tables/", { signal })))(),
  ]);
  const tables = [...firstTables.results];
  let next = firstTables.next;
  let page = 1;
  while (next) {
    page += 1;
    const response = result(
      await api.GET("/api/v1/tables/", { signal, params: { query: { page } } }),
    );
    tables.push(...response.results);
    next = response.next;
  }
  return { plugins, documents, tables };
}
export function Workbench({
  agent,
  tab,
  refresh,
  onDirtyChange,
}: {
  agent: Project;
  tab: ProjectTab;
  refresh: () => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const { canManage } = useWorkspace();
  const projectQuery = `project=${encodeURIComponent(agent.id)}`;
  return (
    <div className="min-w-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="!mb-1 !text-xl">{agent.name}</h2>
          <p className="small">
            Configure the tools and data your MCP agent can use.
          </p>
        </div>
        <span className="badge">{agent.enabled ? "Enabled" : "Disabled"}</span>
      </div>
      <nav
        className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-4"
        aria-label="Project configuration"
      >
        {projectTabs.map((item) => (
          <Button
            asChild
            key={item.id}
            variant={tab === item.id ? "secondary" : "ghost"}
          >
            <WorkspaceLink
              href={`/projects/?${projectQuery}${item.id === "overview" ? "" : `&tab=${item.id}`}`}
              aria-current={tab === item.id ? "page" : undefined}
            >
              {item.label}
            </WorkspaceLink>
          </Button>
        ))}
      </nav>
      {tab === "overview" ? <ProjectOverview agent={agent} /> : undefined}
      {tab === "access" ? (
        <ProjectAccess
          agent={agent}
          refresh={refresh}
          onDirtyChange={onDirtyChange}
        />
      ) : undefined}
      {tab === "runner" ? (
        canManage ? (
          <AgentRunner agent={agent} refresh={refresh} />
        ) : (
          <section className="panel">
            <h2>Project runner</h2>
            <p>
              {agent.runner.registered ? "Registered" : "Not registered"} ·{" "}
              {agent.runner.enabled ? "Enabled" : "Revoked"}
            </p>
            <p className="small mt-3">
              An owner or admin can configure this project’s runner.
            </p>
          </section>
        )
      ) : undefined}
      {tab === "settings" ? (
        <ProjectSettings
          agent={agent}
          refresh={refresh}
          onDirtyChange={onDirtyChange}
        />
      ) : undefined}
    </div>
  );
}
function ProjectOverview({ agent }: { agent: Project }): ReactNode {
  const query = useWorkspaceQuery(loadProjectActivity);
  const projectQuery = `project=${encodeURIComponent(agent.id)}`;
  const actions = query.data?.actions.filter(
    (action) => (action.project ?? action.agent) === agent.id,
  );
  const runs = query.data?.runs
    .filter((run) => run.project === agent.id)
    .slice(0, 5);
  return (
    <>
      <section className="panel">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="space-y-3">
            <h2 className="!mb-0">Connect your agent over MCP</h2>
            <p className="max-w-2xl">
              Connect an external agent to this project to build and run
              actions. Choose the plugins and workspace data it can access, then
              use saved actions to review runs, add schedules and receive
              webhooks.
            </p>
          </div>
          <Button asChild>
            <WorkspaceLink href={`/connections/?${projectQuery}`}>
              Connect agent
            </WorkspaceLink>
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-200 pt-4">
          <Button asChild variant="outline">
            <WorkspaceLink href={`/projects/?${projectQuery}&tab=access`}>
              Configure data access
            </WorkspaceLink>
          </Button>
          <Button asChild variant="outline">
            <WorkspaceLink href={`/plugins/?${projectQuery}`}>
              Manage plugins
            </WorkspaceLink>
          </Button>
          <Button asChild variant="outline">
            <WorkspaceLink href={`/projects/?${projectQuery}&tab=runner`}>
              {agent.runner.registered ? "Manage runner" : "Set up runner"}
            </WorkspaceLink>
          </Button>
        </div>
      </section>
      <ResourceState {...query} />
      <section className="panel" aria-labelledby="project-actions-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="project-actions-heading" className="!mb-1">
              Saved actions
            </h2>
            <p className="small">
              Open an action to manage its code, runs, schedule and webhook.
            </p>
          </div>
          <Button asChild variant="outline">
            <WorkspaceLink href={`/actions/?${projectQuery}`}>
              View all actions
            </WorkspaceLink>
          </Button>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {actions?.slice(0, 4).map((action) => (
            <ActionCard key={action.id} action={action} />
          ))}
        </div>
        {actions?.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-5">
            <h3>No saved actions yet</h3>
            <p className="small mt-2">
              Create an action or ask your connected agent to build one.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <WorkspaceLink href={`/actions/?${projectQuery}&new=1`}>
                Create action
              </WorkspaceLink>
            </Button>
          </div>
        ) : undefined}
      </section>
      <section className="panel" aria-labelledby="project-runs-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-runs-heading" className="!mb-0">
            Recent runs
          </h2>
          <Button asChild variant="outline">
            <WorkspaceLink href={`/runs/?${projectQuery}`}>
              View all runs
            </WorkspaceLink>
          </Button>
        </div>
        <div className="grid gap-3">
          {runs?.map((run) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4"
              key={run.id}
            >
              <div className="min-w-0">
                <span className="text-sm font-medium">
                  {run.operation} · {run.status}
                </span>
                <p className="small mt-1">
                  {new Date(run.created_at).toLocaleString()}
                </p>
              </div>
              <Button asChild variant="outline">
                <WorkspaceLink
                  href={`/runs/?${projectQuery}&run=${encodeURIComponent(run.id)}`}
                >
                  Inspect run
                </WorkspaceLink>
              </Button>
            </div>
          ))}
        </div>
        {runs?.length === 0 ? (
          <p>No runs yet. Run an action to see its results here.</p>
        ) : undefined}
      </section>
    </>
  );
}
function ProjectAccess({
  agent,
  refresh,
  onDirtyChange,
}: {
  agent: Project;
  refresh: () => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const { canManage } = useWorkspace();
  const query = useWorkspaceQuery(loadProjectAccess);
  const [grants, setGrants] = useState(() => ({
    readable_tables: agent.readable_tables ?? [],
    writable_tables: agent.writable_tables ?? [],
    readable_documents: agent.readable_documents ?? [],
    writable_documents: agent.writable_documents ?? [],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useUnsavedChanges(
    grantFields.some(
      ({ field }) =>
        JSON.stringify(grants[field]) !== JSON.stringify(agent[field] ?? []),
    ),
    onDirtyChange,
  );
  const save = async (): Promise<void> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = result(
        await api.PATCH("/api/v1/projects/{id}/", {
          params: { path: { id: agent.id } },
          body: grants,
        }),
      );
      await refresh();
      setGrants({
        readable_tables: updated.readable_tables ?? [],
        writable_tables: updated.writable_tables ?? [],
        readable_documents: updated.readable_documents ?? [],
        writable_documents: updated.writable_documents ?? [],
      });
      setNotice("Project data access saved.");
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  const plugins = query.data?.plugins.filter(
    (plugin) => plugin.agent === agent.id,
  );
  return (
    <>
      <section className="panel">
        <h2>Workspace data access</h2>
        <p className="mb-5 max-w-3xl">
          Choose the shared tables and documents available to this project’s
          actions. Changes apply to new runs; adding access cannot widen a run
          that has already been submitted.
        </p>
        {canManage ? undefined : (
          <p className="small mb-5">
            Only owners and admins can change project data access.
          </p>
        )}
        <ResourceState {...query} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {grantFields.map(({ field, label, resource: resourceKind }) => {
              const resources = query.data?.[resourceKind];
              return (
                <div
                  key={field}
                  className="min-w-0 rounded-lg border border-slate-200 p-4"
                >
                  <fieldset
                    className="!m-0 min-w-0 !border-0 !p-0"
                    disabled={!canManage || busy}
                  >
                    <legend className="!mb-3 !text-sm font-semibold">
                      {label}
                    </legend>
                    <div className="grid gap-3">
                      {resources?.map((resource) => (
                        <label
                          className="check !m-0 !items-start gap-2"
                          key={resource.id}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 shrink-0"
                            checked={grants[field].includes(resource.id)}
                            onChange={(event) => {
                              setGrants((previous) => ({
                                ...previous,
                                [field]: event.target.checked
                                  ? [...previous[field], resource.id]
                                  : previous[field].filter(
                                      (id) => id !== resource.id,
                                    ),
                              }));
                            }}
                          />
                          <span className="min-w-0 break-words">
                            {"name" in resource
                              ? resource.name
                              : resource.title}
                          </span>
                        </label>
                      ))}
                    </div>
                    {resources?.length === 0 ? (
                      <p className="small">No workspace {resourceKind} yet.</p>
                    ) : undefined}
                  </fieldset>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canManage ? (
              <Button
                type="submit"
                disabled={busy || query.isLoading || !query.data}
              >
                {busy ? "Saving…" : "Save data access"}
              </Button>
            ) : undefined}
            <WorkspaceLink href="/tables/">
              Manage workspace tables
            </WorkspaceLink>
            <WorkspaceLink href="/documents/">
              Manage workspace documents
            </WorkspaceLink>
          </div>
        </form>
        {error ? (
          <p className="error mt-4" role="alert">
            {error}
          </p>
        ) : undefined}
        {notice ? (
          <p className="notice mt-4" role="status">
            {notice}
          </p>
        ) : undefined}
      </section>
      <section className="panel">
        <h2>Project plugins</h2>
        <p>
          Plugins add tools your agent can use in this project. Configure each
          plugin’s credentials separately.
        </p>
        <div className="my-4 grid gap-2">
          {plugins?.map((plugin) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3"
              key={plugin.id}
            >
              <span className="text-sm">
                {plugin.slug} · {plugin.version}
              </span>
              <span className="badge">
                {plugin.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          ))}
          {plugins?.length === 0 ? (
            <p className="small">No plugins installed in this project.</p>
          ) : undefined}
        </div>
        <Button asChild variant="outline">
          <WorkspaceLink
            href={`/plugins/?project=${encodeURIComponent(agent.id)}`}
          >
            Manage project plugins
          </WorkspaceLink>
        </Button>
      </section>
    </>
  );
}
function ProjectSettings({
  agent,
  refresh,
  onDirtyChange,
}: {
  agent: Project;
  refresh: () => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const { canManage, navigateTo } = useWorkspace();
  const [name, setName] = useState(agent.name);
  const [enabled, setEnabled] = useState(agent.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canConfirm = useDiscardConfirmation();
  useUnsavedChanges(
    name !== agent.name || enabled !== (agent.enabled ?? true),
    onDirtyChange,
  );
  const save = async (): Promise<void> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = result(
        await api.PATCH("/api/v1/projects/{id}/", {
          params: { path: { id: agent.id } },
          body: { name: name.trim(), enabled },
        }),
      );
      await refresh();
      setName(updated.name);
      setNotice("Project settings saved.");
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (
      !(await canConfirm({
        title: "Delete this project?",
        description:
          "Its actions and versions will be removed. Projects referenced by retained run history cannot be deleted.",
        actionLabel: "Delete project",
      }))
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      requireSuccess(
        await api.DELETE("/api/v1/projects/{id}/", {
          params: { path: { id: agent.id } },
        }),
      );
      onDirtyChange(false);
      await refresh();
      await navigateTo("/projects/");
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <h2>Project settings</h2>
        <form
          className="max-w-2xl"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Project name
            <Input
              value={name}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
              }}
              required
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
              }}
            />
            Enabled for new work
          </label>
          <p className="small mt-2">
            Actions execute serially in this project’s persistent working
            folder.
          </p>
          <Button
            className="mt-5"
            type="submit"
            disabled={busy || !name.trim()}
          >
            {busy ? "Saving…" : "Save project"}
          </Button>
        </form>
        {error ? (
          <p className="error mt-4" role="alert">
            {error}
          </p>
        ) : undefined}
        {notice ? (
          <p className="notice mt-4" role="status">
            {notice}
          </p>
        ) : undefined}
      </section>
      {canManage ? (
        <section className="panel">
          <h2>Delete project</h2>
          <p>
            Delete this project and its saved actions. Projects with retained
            run history cannot be deleted.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void remove();
            }}
          >
            Delete project
          </Button>
        </section>
      ) : undefined}
    </>
  );
}
