"use client";
import { Search } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import type { components } from "../api/schema";
import { api } from "../api/client";
import { result } from "../api/result";
import { useWorkspaceQuery } from "../api/use-workspace-query";
import { loadRuns } from "../api/workspace-queries";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ResourceState } from "./workspace/resource-state";
import { RunStatus, runLabel } from "./workspace/run-display";
import { useWorkspace } from "./workspace/workspace-context";
import { RunDetail } from "./workspace/run-detail";
export function Runs({
  agents,
  selected,
  onSelect,
  actionId = "",
}: {
  agents: components["schemas"]["Agent"][];
  selected: string;
  onSelect: (id: string) => void;
  actionId?: string;
}): ReactNode {
  const { selected: projectId } = useWorkspace();
  const loadHistory = useCallback(
    async (signal: AbortSignal) => {
      const [runs, versions] = await Promise.all([
        loadRuns(signal),
        actionId
          ? (async () =>
              result(
                await api.GET("/api/v1/actions/{id}/versions/", {
                  signal,
                  params: { path: { id: actionId } },
                }),
              ))()
          : undefined,
      ]);
      const versionIds = new Set(versions?.map((version) => version.id));
      return runs.filter(
        (run) =>
          run.project === projectId &&
          (!actionId ||
            (run.action_version !== null &&
              versionIds.has(run.action_version))),
      );
    },
    [actionId, projectId],
  );
  const query = useWorkspaceQuery(loadHistory, 5000);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [operation, setOperation] = useState("");
  const runs =
    query.data?.filter(
      (run) =>
        run.project === projectId &&
        (!status || run.status === status) &&
        (!operation || run.operation === operation) &&
        `${runLabel(run, agents)} ${run.id}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  if (selected && !query.data?.some((run) => run.id === selected))
    return (
      <>
        <ResourceState {...query} />
        {query.isLoading || query.error ? null : (
          <p role="alert">
            This run is not available in this action or project.
          </p>
        )}
      </>
    );
  if (selected)
    return (
      <RunDetail
        key={selected}
        id={selected}
        agents={agents}
        back={() => {
          onSelect("");
        }}
        openRun={onSelect}
      />
    );
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Run history</h2>
        <span className="badge">{runs.length} runs</span>
      </div>
      <p className="small">
        Project:{" "}
        {agents.find((project) => project.id === projectId)?.name ??
          "Choose a project"}
      </p>
      <div className="resource-toolbar">
        <label className="search-field">
          <Search size={15} />
          <Input
            aria-label="Search runs"
            placeholder="Search by project or run ID…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
        <select
          aria-label="Run status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
          }}
        >
          <option value="">All statuses</option>
          {[
            "queued",
            "running",
            "waiting_approval",
            "succeeded",
            "failed",
            "cancelled",
            "interrupted",
          ].map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select
          aria-label="Run type"
          value={operation}
          onChange={(event) => {
            setOperation(event.target.value);
          }}
        >
          <option value="">All work</option>
          <option value="action">Actions</option>
          <option value="code">Code execution</option>
          <option value="validate">Code validation</option>
          <option value="test">Action tests</option>
          <option value="chat">Chat tasks</option>
        </select>
      </div>
      <ResourceState {...query} />
      {!query.isLoading && runs.length === 0 ? (
        <div className="resource-empty">
          <h3>No matching runs</h3>
          <p>
            Execute code from an external client or run a saved action, then
            follow its progress here.
          </p>
        </div>
      ) : undefined}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Work</th>
              <th>Status</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <strong>{runLabel(run, agents)}</strong>
                  <small className="block muted">{run.id.slice(0, 8)}</small>
                </td>
                <td>
                  <RunStatus status={run.status} />
                </td>
                <td>{new Date(run.created_at).toLocaleString()}</td>
                <td>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onSelect(run.id);
                    }}
                  >
                    View run
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
