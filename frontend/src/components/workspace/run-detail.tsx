"use client";
import type { Project, Run, Artifact } from "../../api/types";
import { ArrowLeft, Download, RotateCcw, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { loadArtifacts } from "../../api/workspace-queries";
import { Button } from "../ui/button";
import { MarkdownContent } from "../markdown-content";
import {
  activeStatuses,
  displayValue,
  runOperationLabel,
  RunStatus,
} from "./run-display";
import { ResourceState } from "./resource-state";
import { useRunDetail } from "./use-run-detail";
import { ActionCheckReport } from "./action-check-report";
import { RunPromotion } from "./run-promotion";
import { ApprovalQueue } from "./approval-queue";
export function downloadArtifact(artifact: Artifact): void {
  const blob = new Blob([artifact.content], {
    type: artifact.media_type,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.name;
  link.click();
  URL.revokeObjectURL(url);
}
function RunOutcome({
  run,
  hasCheckReport,
}: {
  run: Run;
  hasCheckReport: boolean;
}): ReactNode {
  if (hasCheckReport) return <ActionCheckReport output={run.output} />;
  if (run.status !== "succeeded")
    return (
      <p>
        {activeStatuses.includes(run.status)
          ? "This run is still in progress. Its result will appear here."
          : `This run ${run.status}. Review the trace before retrying.`}
      </p>
    );
  return run.operation === "chat" ? (
    <MarkdownContent content={displayValue(run.output)} />
  ) : (
    <pre>{displayValue(run.output) || "Completed without output."}</pre>
  );
}
const outcomeTitles: Record<string, string> = {
  test: "Mocked test results",
  validate: "Semantic validation diagnostics",
};
export function RunDetail({
  id,
  projects,
  back,
  openRun,
}: {
  id: string;
  projects: Project[];
  back: () => void;
  openRun: (id: string) => void;
}): ReactNode {
  const query = useRunDetail(id);
  const artifactQuery = useWorkspaceQuery(loadArtifacts);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = query.data?.run;
  const hasCheckReport =
    run !== undefined &&
    (run.operation === "test" || run.operation === "validate") &&
    run.output !== null &&
    typeof run.output === "object" &&
    Object.hasOwn(run.output, "result");
  const perform = async (operation: "cancel" | "retry"): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      if (operation === "cancel") {
        await trpc.runs.cancel.mutate({ id });
      } else {
        const retry = await trpc.runs.retry.mutate({
          id,
          idempotency_key: crypto.randomUUID(),
        });
        openRun(retry.id);
      }
      await query.refresh();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="run-detail">
      <Button variant="ghost" onClick={back}>
        <ArrowLeft size={14} /> All runs
      </Button>
      <ResourceState {...query} />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}
      {run ? (
        <>
          <section className="panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">RUN {run.id.slice(0, 8)}</p>
                <h2>
                  {projects.find((project) => project.id === run.project)
                    ?.name ?? "Project"}{" "}
                  · {runOperationLabel(run.operation)}
                </h2>
              </div>
              <div className="row">
                <RunStatus status={run.status} />
                {activeStatuses.includes(run.status) ? (
                  <Button
                    variant="outline"
                    disabled={isBusy || run.cancel_requested}
                    onClick={() => {
                      void perform("cancel");
                    }}
                  >
                    <Square size={13} />
                    {run.cancel_requested
                      ? "Cancellation requested"
                      : "Cancel run"}
                  </Button>
                ) : undefined}
                {run.operation !== "chat" &&
                ["failed", "interrupted", "cancelled"].includes(run.status) ? (
                  <Button
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => {
                      void perform("retry");
                    }}
                  >
                    <RotateCcw size={13} /> Retry run
                  </Button>
                ) : undefined}
              </div>
            </div>
            <p className="small">
              Created {new Date(run.created_at).toLocaleString()} · Updated{" "}
              {new Date(run.updated_at).toLocaleString()}
            </p>
            {run.retry_of ? (
              <Button
                variant="link"
                onClick={() => {
                  openRun(run.retry_of ?? "");
                }}
              >
                View original run
              </Button>
            ) : undefined}
            {run.error ? (
              <div className="error" role="alert">
                {run.error}
              </div>
            ) : undefined}
            <dl>
              <dt>Origin</dt>
              <dd>
                {run.origin} {run.origin_reference}
              </dd>
              <dt>Originating client</dt>
              <dd>
                {run.client_token ??
                  "No client token (historical attribution may be unknown)"}
              </dd>
              <dt>SDK revision</dt>
              <dd>{displayValue(run.sdk_revision) || "Unknown"}</dd>
              <dt>Configuration revision</dt>
              <dd>{displayValue(run.configuration_revision) || "Unknown"}</dd>
              <dt>Immutable action version</dt>
              <dd>{run.action_version ?? "One-off source / none"}</dd>
              <dt>Source digest</dt>
              <dd>{displayValue(run.source_digest) || "Unknown"}</dd>
            </dl>
            {run.source === null ? null : (
              <details>
                <summary>Accepted source</summary>
                <pre>{displayValue(run.source)}</pre>
              </details>
            )}
            {run.operation === "code" && run.source !== null ? (
              <RunPromotion key={run.id} id={run.id} />
            ) : null}
            <h3>{outcomeTitles[run.operation] ?? "Outcome"}</h3>
            <RunOutcome run={run} hasCheckReport={hasCheckReport} />
            <details>
              <summary>Run inputs</summary>
              <pre>{displayValue(run.inputs)}</pre>
            </details>
          </section>
          {run.status === "waiting_approval" ? (
            <ApprovalQueue runId={id} />
          ) : undefined}
          <section className="panel">
            <h2>Artifacts</h2>
            <ResourceState {...artifactQuery} />
            {artifactQuery.data?.filter((artifact) => artifact.run === id)
              .length === 0 ? (
              <p className="small">No artifacts were saved by this run.</p>
            ) : undefined}
            {artifactQuery.data
              ?.filter((artifact) => artifact.run === id)
              .map((artifact) => (
                <details key={artifact.id}>
                  <summary>{artifact.name}</summary>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      downloadArtifact(artifact);
                    }}
                  >
                    <Download size={13} />
                    Download
                  </Button>
                  <pre>{artifact.content}</pre>
                </details>
              ))}
          </section>
          <section className="panel">
            <h2>Execution trace</h2>
            {query.data?.events.length === 0 ? (
              <p className="small">Waiting for the first execution event.</p>
            ) : undefined}
            <ol className="run-timeline">
              {query.data?.events.map((event) => (
                <li key={event.sequence}>
                  <span className="timeline-dot" />
                  <details>
                    <summary>
                      <strong>{event.kind.replaceAll(".", " ")}</strong>
                      <time>
                        {new Date(event.created_at).toLocaleTimeString()}
                      </time>
                    </summary>
                    <pre>{displayValue(event.data)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : undefined}
    </div>
  );
}
