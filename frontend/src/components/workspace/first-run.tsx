"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { errorMessage } from "../../api/result";
import { trpc } from "../../api/trpc";
import type { Project, Run } from "../../api/types";
import { Button } from "../ui/button";
import { runnerStatus } from "./runner-status";
import { WorkspaceLink } from "./workspace-link";
import { useWorkspace } from "./workspace-context";

export function FirstRun({
  project,
  checkedAt,
  succeededRun,
  hasClientAccess,
  hasAction,
}: {
  project: Project;
  checkedAt: number;
  succeededRun: Run | undefined;
  hasClientAccess: boolean | undefined;
  hasAction: boolean;
}): ReactNode {
  const { openRun, goTo } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef("");
  const status = runnerStatus(project.runner, checkedAt);
  const canCheck =
    project.enabled &&
    status === "Available" &&
    project.runner.capabilities.includes("code");
  let guidance =
    "For a local install, keep orgsdk start running. Runner status refreshes automatically.";
  if (!project.enabled) {
    guidance = "Enable this project in its settings to run the check.";
  } else if (canCheck) {
    guidance =
      "Run a short check that returns “Runner ready”. It uses no plugins or project files.";
  } else if (status === "Available") {
    guidance = "This runner needs the code capability to run the check.";
  }
  const steps = [
    ...(hasClientAccess === undefined
      ? []
      : [
          {
            label: "Grant project access to a client",
            done: hasClientAccess,
            view: "connections",
          },
        ]),
    { label: "Create your first action", done: hasAction, view: "actions" },
  ];
  const completed =
    Number(Boolean(succeededRun)) + steps.filter((step) => step.done).length;
  if (completed === steps.length + 1) return null;

  async function checkRunner() {
    setBusy(true);
    setError("");
    try {
      if (!requestKey.current)
        requestKey.current = crypto
          .getRandomValues(new Uint32Array(4))
          .join("-");
      const run = await trpc.runs.create.mutate({
        project: project.id,
        operation: "code",
        source: 'return "Runner ready";',
        inputs: {},
        idempotency_key: requestKey.current,
      });
      openRun(run.id);
    } catch (error_) {
      setError(errorMessage(error_));
      setBusy(false);
    }
  }

  return (
    <section className="panel first-run" aria-labelledby="first-run-title">
      <div className="panel-title">
        <h2 id="first-run-title">Get your project running</h2>
        <span className="badge">
          {completed} of {steps.length + 1} complete
        </span>
      </div>
      <h3>{project.name}</h3>
      <p className="small" role="status">
        Runner · {status}
      </p>
      {succeededRun ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            openRun(succeededRun.id);
          }}
        >
          View successful run <ArrowRight size={14} />
        </Button>
      ) : (
        <>
          <p className="mb-3">{guidance}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy || !canCheck}
              onClick={() => void checkRunner()}
            >
              {busy ? "Starting check…" : "Run installation check"}
            </Button>
            <WorkspaceLink
              href={`/projects/?project=${encodeURIComponent(project.id)}&tab=${project.enabled ? "runner" : "settings"}`}
            >
              {project.enabled ? "Runner settings" : "Project settings"}
            </WorkspaceLink>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </>
      )}
      <div className="onboarding-steps mt-4">
        {steps.map((step) => (
          <button
            key={step.view}
            className={step.done ? "is-complete" : ""}
            onClick={() => {
              goTo(step.view);
            }}
          >
            {step.done ? (
              <CheckCircle2 size={17} aria-label="Complete" />
            ) : (
              <Circle size={17} aria-label="Incomplete" />
            )}
            {step.label}
            <ArrowRight size={14} />
          </button>
        ))}
      </div>
    </section>
  );
}
