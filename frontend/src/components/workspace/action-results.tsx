"use client";
import { useCallback, type ReactNode } from "react";
import {
  ArrowUpRight,
  Download,
  FileJson,
  FileText,
  Files,
  Terminal,
} from "lucide-react";
import { trpc } from "../../api/trpc";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { loadArtifacts } from "../../api/workspace-queries";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Button } from "../ui/button";
import { ResourceState } from "./resource-state";
import {
  activeStatuses,
  displayValue,
  RunStatus,
  type Run,
} from "./run-display";
import { downloadArtifact } from "./run-detail";
import { WorkspaceLink } from "./workspace-link";

export function ActionRunHistory({
  runs,
  selectedId,
  onSelect,
}: {
  runs: Run[];
  selectedId: string;
  onSelect: (id: string) => void;
}): ReactNode {
  if (runs.length === 0)
    return (
      <div className="action-empty">
        <Terminal size={24} />
        <p>No runs yet. Save and run this action to see its activity.</p>
      </div>
    );
  return (
    <div className="action-run-table">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className={selectedId === run.id ? "is-selected" : ""}
            >
              <td>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="action-run-link px-0"
                  aria-label={`Inspect run ${run.id.slice(0, 8)}`}
                  aria-pressed={selectedId === run.id}
                  onClick={() => {
                    onSelect(run.id);
                  }}
                >
                  #{run.id.slice(0, 8)}
                </Button>
              </td>
              <td>
                <RunStatus status={run.status} />
              </td>
              <td>
                <time
                  dateTime={run.created_at}
                  title={new Date(run.created_at).toLocaleString()}
                >
                  {new Date(run.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                  <small>
                    {new Date(run.created_at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function RunArtifacts({ run }: { run: Run }): ReactNode {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const artifacts = await loadArtifacts(signal);
      return artifacts.filter((artifact) => artifact.run === run.id);
    },
    [run.id],
  );
  const query = useWorkspaceQuery(
    load,
    activeStatuses.includes(run.status) ? 5000 : 0,
  );
  return (
    <>
      <ResourceState {...query} />
      {query.data?.length === 0 ? (
        <div className="action-empty">
          <Files size={24} />
          <p>No artifacts saved by this run.</p>
          <span>Files created by the action will appear here.</span>
        </div>
      ) : null}
      <div className="action-artifact-grid">
        {query.data?.map((artifact) => {
          const Icon = artifact.media_type.includes("json")
            ? FileJson
            : FileText;
          return (
            <article className="action-artifact" key={artifact.id}>
              <header>
                <span className="artifact-symbol">
                  <Icon size={20} />
                </span>
                <div>
                  <strong title={artifact.name}>{artifact.name}</strong>
                  <small>
                    {artifact.media_type} ·{" "}
                    {new Blob([artifact.content]).size.toLocaleString()} B
                  </small>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Download ${artifact.name}`}
                  onClick={() => {
                    downloadArtifact(artifact);
                  }}
                >
                  <Download size={15} />
                </Button>
              </header>
              <details>
                <summary>Preview file</summary>
                <pre>{artifact.content}</pre>
              </details>
              <pre className="artifact-excerpt" aria-hidden="true">
                {artifact.content.slice(0, 450)}
              </pre>
            </article>
          );
        })}
      </div>
    </>
  );
}
function RunLogs({ run }: { run: Run }): ReactNode {
  const load = useCallback(
    async (signal: AbortSignal) =>
      trpc.runs.events.query({ id: run.id }, { signal }),
    [run.id],
  );
  const query = useWorkspaceQuery(
    load,
    activeStatuses.includes(run.status) ? 3000 : 0,
  );
  return (
    <div className="action-logs">
      <ResourceState {...query} />
      {run.error ? (
        <p className="error" role="alert">
          {run.error}
        </p>
      ) : null}
      {query.data?.length === 0 ? (
        <p className="small">No execution events yet.</p>
      ) : null}
      {query.data?.map((event) => (
        <div className="action-log-line" key={event.sequence}>
          <time>{new Date(event.created_at).toLocaleTimeString()}</time>
          <details>
            <summary>{event.kind.replaceAll(".", " ")}</summary>
            <pre>{displayValue(event.data)}</pre>
          </details>
        </div>
      ))}
    </div>
  );
}
const resultTabs = ["Run artifacts", "Logs", "Output"] as const;
export function ActionResults({ run }: { run: Run | undefined }): ReactNode {
  return (
    <section
      aria-label="Action run results"
      className="action-card action-results"
    >
      <Tabs defaultValue="Run artifacts" className="action-result-tabs">
        <TabsList aria-label="Run information">
          {resultTabs.map((label) => (
            <TabsTrigger key={label} value={label}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {resultTabs.map((label) => (
          <TabsContent key={label} value={label}>
            {run ? (
              <>
                <div className="action-result-context">
                  <span>
                    Run #{run.id.slice(0, 8)} <RunStatus status={run.status} />
                  </span>
                  <WorkspaceLink href={`/runs/?run=${run.id}`}>
                    Run details <ArrowUpRight size={13} />
                  </WorkspaceLink>
                </div>
                {label === "Run artifacts" && (
                  <RunArtifacts key={`${run.id}-${run.status}`} run={run} />
                )}
                {label === "Logs" && <RunLogs key={run.id} run={run} />}
                {label === "Output" && (
                  <pre className="action-output">
                    {activeStatuses.includes(run.status)
                      ? "This run is in progress. Its output will appear here."
                      : run.error ||
                        displayValue(run.output) ||
                        "This run completed without output."}
                  </pre>
                )}
              </>
            ) : (
              <div className="action-empty">
                <Files size={26} />
                <p>Your run results will appear here.</p>
                <span>
                  Save your action, then choose Run selected version to get
                  started.
                </span>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
