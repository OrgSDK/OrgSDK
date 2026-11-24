"use client";
import { ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { loadApprovals } from "../../api/workspace-queries";
import { Button } from "../ui/button";
import { useWorkspace } from "./workspace-context";
import { ResourceState } from "./resource-state";
function approveLabel(isSaving: boolean, isShell: boolean): string {
  if (isSaving) return "Saving decision…";
  return isShell ? "Allow once" : "Approve";
}
export function ApprovalQueue({
  runId,
  openRun,
}: {
  runId?: string;
  openRun?: (id: string) => void;
}): ReactNode {
  const { canManage, projects } = useWorkspace();
  const query = useWorkspaceQuery(loadApprovals, 5000);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const approvals =
    query.data?.filter(
      (item) => item.status === "pending" && (!runId || item.run === runId),
    ) ?? [];
  const decide = async (
    id: string,
    decision: "approved" | "denied" | "always_allow" | "block",
  ): Promise<void> => {
    setBusyId(id);
    setError("");
    try {
      await trpc.approvals.decide.mutate({ id, decision });
      await query.refresh();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusyId("");
    }
  };
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>
          <ShieldCheck size={18} /> {runId ? "Run approvals" : "Approval queue"}
        </h2>
        <span className="badge">{approvals.length} pending</span>
      </div>
      <ResourceState {...query} />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}
      {!query.isLoading && approvals.length === 0 ? (
        <div className="resource-empty">
          <ShieldCheck size={28} />
          <h3>All caught up</h3>
          <p>No decisions are waiting for you.</p>
        </div>
      ) : undefined}
      {approvals.map((approval) => (
        <article className="approval-card" key={approval.id}>
          <span className="eyebrow">Human approval required</span>
          {approval.shell ? (
            <>
              <p>
                Run <strong>{approval.shell.executable}</strong> on the executor
                for{" "}
                <strong>
                  {projects.find(
                    (project) => project.id === approval.shell?.project,
                  )?.name ?? approval.shell.project}
                </strong>
                ?
              </p>
              <pre className="approval-prompt whitespace-pre-wrap break-all">
                {approval.prompt}
              </pre>
              <p className="small">
                Always allow and Block apply to every argument for this
                executable in this project.
              </p>
            </>
          ) : (
            <p className="approval-prompt">{approval.prompt}</p>
          )}
          <div className="row">
            <Button
              disabled={!!busyId || !canManage}
              onClick={() => {
                void decide(approval.id, "approved");
              }}
            >
              {approveLabel(busyId === approval.id, Boolean(approval.shell))}
            </Button>
            {approval.shell && (
              <Button
                variant="outline"
                disabled={!!busyId || !canManage}
                onClick={() => void decide(approval.id, "always_allow")}
              >
                Always allow {approval.shell.executable}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!!busyId || !canManage}
              onClick={() => {
                void decide(approval.id, approval.shell ? "block" : "denied");
              }}
            >
              {approval.shell ? `Block ${approval.shell.executable}` : "Deny"}
            </Button>
            {openRun ? (
              <Button
                variant="ghost"
                onClick={() => {
                  openRun(approval.run);
                }}
              >
                Inspect run
              </Button>
            ) : undefined}
          </div>
        </article>
      ))}
    </section>
  );
}
