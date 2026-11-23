"use client";
import {
  Activity,
  Bell,
  Folder,
  Cable,
  Code2,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import {
  loadActions,
  loadProjects,
  loadApprovals,
  loadTokens,
  loadPlugins,
  loadRuns,
} from "../../api/workspace-queries";
import type { Action, Project, Approval, Token, Plugin } from "../../api/types";
import { useWorkspace } from "./workspace-context";
import { Button } from "../ui/button";
import { ResourceState } from "./resource-state";
import { activeStatuses, runLabel, RunStatus, type Run } from "./run-display";
import { FirstRun } from "./first-run";
import { QuickAction, SignalCard } from "./home-cards";
interface OverviewData {
  checkedAt: number;
  runs: Run[];
  projects: Project[];
  actions: Action[];
  approvals: Approval[];
  tokens: Token[];
  plugins: Plugin[];
}
async function loadOverview(
  signal: AbortSignal,
  canManage: boolean,
): Promise<OverviewData> {
  const [runs, projects, actions, approvals, tokens, plugins] =
    await Promise.all([
      loadRuns(signal),
      loadProjects(signal),
      loadActions(signal),
      loadApprovals(signal),
      canManage ? loadTokens(signal) : Promise.resolve([]),
      loadPlugins(signal),
    ]);
  return {
    checkedAt: Date.now(),
    runs,
    projects,
    actions,
    approvals,
    tokens,
    plugins,
  };
}
export function Overview({
  navigate,
  openRun,
}: {
  navigate: (view: string) => void;
  openRun: (id: string) => void;
}): ReactNode {
  const { canManage, selected } = useWorkspace();
  const load = useCallback(
    (signal: AbortSignal) => loadOverview(signal, canManage),
    [canManage],
  );
  const query = useWorkspaceQuery(load, 10_000);
  const data = query.data;
  const pending =
    data?.approvals.filter((item) => item.status === "pending") ?? [];
  const active =
    data?.runs.filter((run) => activeStatuses.includes(run.status)) ?? [];
  const failed = data?.runs.find(
    (run) => run.status === "failed" || run.status === "interrupted",
  );
  const project = data?.projects.find((item) => item.id === selected);
  return (
    <div className="overview">
      <ResourceState {...query} />
      {data ? (
        <>
          {project ? (
            <FirstRun
              key={project.id}
              project={project}
              checkedAt={data.checkedAt}
              succeededRun={data.runs.find(
                (run) =>
                  run.project === project.id && run.status === "succeeded",
              )}
              hasClientAccess={
                canManage
                  ? data.tokens.some(
                      (token) =>
                        !token.revoked && token.projects.includes(project.id),
                    )
                  : undefined
              }
              hasAction={data.actions.some(
                (action) => action.project === project.id,
              )}
            />
          ) : (
            <Button
              onClick={() => {
                navigate("work");
              }}
            >
              Create a project
            </Button>
          )}
          <section className="signal-grid" aria-label="Workspace signals">
            <SignalCard
              label="Actions"
              value={String(data.actions.length)}
              hint="Reusable workflows"
              onClick={() => {
                navigate("actions");
              }}
            />
            <SignalCard
              label="Pending approvals"
              value={String(pending.length)}
              hint="Decisions waiting for you"
              hasWarning={pending.length > 0}
              onClick={() => {
                navigate("approvals");
              }}
            />
            <SignalCard
              label="Runs in progress"
              value={String(active.length)}
              hint={`${String(data.runs.length)} total runs`}
              onClick={() => {
                navigate("runs");
              }}
            />
            <SignalCard
              label="Projects"
              value={String(data.projects.length)}
              hint={`${String(data.plugins.length)} installed plugins`}
              onClick={() => {
                navigate("work");
              }}
            />
          </section>
          {pending.length > 0 ? (
            <section className="next-action">
              <Bell size={20} />
              <div>
                <h2>
                  {pending.length} approval{pending.length === 1 ? "" : "s"}{" "}
                  waiting
                </h2>
                <p>Review the requested work before it proceeds.</p>
              </div>
              <Button
                onClick={() => {
                  navigate("approvals");
                }}
              >
                Review approvals
              </Button>
            </section>
          ) : undefined}
          {failed && pending.length === 0 ? (
            <section className="next-action">
              <Activity size={20} />
              <div>
                <h2>Review the latest failed run</h2>
                <p>
                  Inspect the result and trace before deciding whether to retry.
                </p>
              </div>
              <Button
                onClick={() => {
                  openRun(failed.id);
                }}
              >
                Open run
              </Button>
            </section>
          ) : undefined}
          {active.length > 0 ? (
            <section className="panel running-region" aria-label="Running now">
              <h2>
                <Activity size={17} /> Running now
              </h2>
              {active.map((run) => (
                <div className="resource-row" key={run.id}>
                  <span>{runLabel(run, data.projects)}</span>
                  <RunStatus status={run.status} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      openRun(run.id);
                    }}
                  >
                    View run
                  </Button>
                </div>
              ))}
            </section>
          ) : undefined}
          <section className="panel">
            <div className="panel-title">
              <h2>Recent runs</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  navigate("runs");
                }}
              >
                All runs <ArrowRight size={14} />
              </Button>
            </div>
            {data.runs.length === 0 ? (
              <div className="resource-empty">
                <CheckCircle2 size={28} />
                <h3>No runs yet</h3>
                <p>Completed and in-progress runs will appear here.</p>
              </div>
            ) : (
              data.runs.slice(0, 5).map((run) => (
                <div className="resource-row" key={run.id}>
                  <div>
                    <strong>{runLabel(run, data.projects)}</strong>
                    <small>{new Date(run.created_at).toLocaleString()}</small>
                  </div>
                  <RunStatus status={run.status} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      openRun(run.id);
                    }}
                  >
                    Open
                  </Button>
                </div>
              ))
            )}
          </section>
          <section className="quick-grid" aria-label="Quick actions">
            <QuickAction
              icon={Code2}
              label="Build an action"
              description="Write, version and run a workflow."
              onClick={() => {
                navigate("actions");
              }}
            />
            <QuickAction
              icon={Folder}
              label="Configure a project"
              description="Set up its runner, integrations and data access."
              onClick={() => {
                navigate("work");
              }}
            />
            <QuickAction
              icon={Cable}
              label="Manage connections"
              description="Connect clients and secure credentials."
              onClick={() => {
                navigate("connections");
              }}
            />
          </section>
        </>
      ) : undefined}
    </div>
  );
}
