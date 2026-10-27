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
import type { ReactNode } from "react";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import {
  loadActions,
  loadAgents,
  loadApprovals,
  loadTokens,
  loadPlugins,
  loadRuns,
} from "../../api/workspace-queries";
import type { components } from "../../api/schema";
import { Button } from "../ui/button";
import { ResourceState } from "./resource-state";
import { activeStatuses, runLabel, RunStatus, type Run } from "./run-display";
import { QuickAction, SignalCard } from "./home-cards";
interface OverviewData {
  runs: Run[];
  agents: components["schemas"]["Agent"][];
  actions: components["schemas"]["Action"][];
  approvals: components["schemas"]["Approval"][];
  tokens: components["schemas"]["Token"][];
  plugins: components["schemas"]["Plugin"][];
}
async function loadOverview(signal: AbortSignal): Promise<OverviewData> {
  const [runs, agents, actions, approvals, tokens, plugins] = await Promise.all(
    [
      loadRuns(signal),
      loadAgents(signal),
      loadActions(signal),
      loadApprovals(signal),
      loadTokens(signal),
      loadPlugins(signal),
    ],
  );
  return { runs, agents, actions, approvals, tokens, plugins };
}
export function Overview({
  navigate,
  openRun,
}: {
  navigate: (view: string) => void;
  openRun: (id: string) => void;
}): ReactNode {
  const query = useWorkspaceQuery(loadOverview, 10_000);
  const data = query.data;
  const pending =
    data?.approvals.filter((item) => item.status === "pending") ?? [];
  const active =
    data?.runs.filter((run) => activeStatuses.includes(run.status)) ?? [];
  const failed = data?.runs.find(
    (run) => run.status === "failed" || run.status === "interrupted",
  );
  const steps = [
    {
      label: "Create a project",
      done: (data?.agents.length ?? 0) > 0,
      view: "work",
    },
    {
      label: "Connect an external client",
      done: (data?.tokens.length ?? 0) > 0,
      view: "connections",
    },
    {
      label: "Create your first action",
      done: (data?.actions.length ?? 0) > 0,
      view: "actions",
    },
    {
      label: "Complete a run",
      done: data?.runs.some((run) => run.status === "succeeded") ?? false,
      view: "runs",
    },
  ];
  return (
    <div className="overview">
      <ResourceState {...query} />
      {data ? (
        <>
          {steps.some((step) => !step.done) ? (
            <section className="panel first-run">
              <div className="panel-title">
                <h2>Get your workspace running</h2>
                <span className="badge">
                  {steps.filter((step) => step.done).length} of {steps.length}{" "}
                  complete
                </span>
              </div>
              <p className="small">
                Connect your tools, publish an action and inspect its first
                result.
              </p>
              <div className="onboarding-steps">
                {steps.map((step) => (
                  <button
                    key={step.label}
                    className={step.done ? "is-complete" : ""}
                    onClick={() => {
                      navigate(step.view);
                    }}
                  >
                    <CheckCircle2 size={17} />
                    {step.label}
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            </section>
          ) : undefined}
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
              value={String(data.agents.length)}
              hint={`${String(data.plugins.length)} installed plugins`}
              onClick={() => {
                navigate("connections");
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
                  <span>{runLabel(run, data.agents)}</span>
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
                <h3>Ready for your first run</h3>
                <p>
                  Connect an external client or create an action to get started.
                </p>
                <Button
                  onClick={() => {
                    navigate("connections");
                  }}
                >
                  Connect a client
                </Button>
              </div>
            ) : (
              data.runs.slice(0, 5).map((run) => (
                <div className="resource-row" key={run.id}>
                  <div>
                    <strong>{runLabel(run, data.agents)}</strong>
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
