"use client";
import { useState, useEffect, type ReactNode } from "react";
import type { Project } from "../../api/types";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { Button } from "../ui/button";
import { useDiscardConfirmation } from "./discard-dialog";

export function ProjectRunner({
  project,
  refresh,
}: {
  project: Pick<Project, "id" | "runner">;
  refresh: () => Promise<void>;
}): ReactNode {
  const [origin, setOrigin] = useState("http://localhost");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canConfirm = useDiscardConfirmation();
  const perform = async (
    shouldRevoke: boolean,
    isLocal = false,
  ): Promise<void> => {
    if (
      !(await canConfirm({
        title: shouldRevoke
          ? "Revoke this project’s runner?"
          : "Register a replacement runner?",
        description:
          "The current runner will lose access. Running tasks may stop. This affects only this project.",
        actionLabel: shouldRevoke ? "Revoke runner" : "Generate token",
      }))
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    setToken("");
    try {
      if (shouldRevoke) {
        await trpc.projects.disconnectExecutor.mutate({ id: project.id });
        setNotice("Runner access revoked.");
      } else {
        const registration = await trpc.projects.connectExecutor.mutate({
          id: project.id,
          locally_managed: isLocal,
        });
        if (isLocal)
          setNotice(
            "Local runner enabled. It will connect when the installation’s runner is running.",
          );
        else setToken(registration.token);
      }
      await refresh();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  const command =
    "orgsdk executor register --url " +
    origin +
    "\norgsdk executor start --mode docker";
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => {
      setNow(Date.now());
    };
    update();
    const timer = setInterval(() => {
      update();
      void refresh().catch((error_: unknown) => {
        setError(errorMessage(error_));
      });
    }, 10_000);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);
  const lastSeen = project.runner.last_seen_at
    ? new Date(project.runner.last_seen_at).getTime()
    : undefined;
  let registrationStatus = "Registered · waiting for connection";
  if (lastSeen !== undefined)
    registrationStatus =
      now - lastSeen > 60_000
        ? "Unavailable · no recent heartbeat"
        : "Available";
  if (!project.runner.enabled) registrationStatus = "Revoked";
  return (
    <section className="panel">
      <h2>Project runner</h2>
      <p className="mb-4">
        This project uses its own runner to execute actions in its persistent
        working folder. Starting OrgSDK with <code>orgsdk start</code> also
        starts the local runner.
      </p>
      <p>
        {project.runner.registered ? registrationStatus : "Not registered"} ·{" "}
        {project.runner.locally_managed
          ? "Managed by this installation"
          : "Linked runner"}
      </p>
      {project.runner.last_seen_at ? (
        <p className="small">
          Last connected:{" "}
          {new Date(project.runner.last_seen_at).toLocaleString()}
        </p>
      ) : (
        <p className="small">Waiting for the runner to connect.</p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          disabled={busy}
          onClick={() => {
            void perform(false);
          }}
        >
          Generate registration token
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void perform(false, true);
          }}
        >
          Use local runner
        </Button>
        <Button
          variant="outline"
          disabled={
            busy || !project.runner.registered || !project.runner.enabled
          }
          onClick={() => {
            void perform(true);
          }}
        >
          Revoke runner
        </Button>
      </div>
      {token ? (
        <div className="mt-5 grid gap-3">
          <p>
            Copy this token now. It is shown once. Paste it at the registration
            prompt.
          </p>
          <code className="break-all">{token}</code>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(token)
                .then(() => {
                  setNotice("Token copied.");
                })
                .catch(() => {
                  setError("Clipboard unavailable. Select and copy the token.");
                });
            }}
          >
            Copy token
          </Button>
        </div>
      ) : null}
      <details
        className="mt-4"
        onToggle={() => {
          setOrigin(location.origin);
        }}
      >
        <summary>Link a separate runner</summary>
        <p className="mt-4">
          The npm-installed OrgSDK command includes the runner. A separate
          runner machine needs Linux and Node.js 22.22 or newer. Docker mode
          also requires Docker and an executor image, network and storage
          configured by your administrator.
        </p>
        <pre className="my-4 overflow-auto">{command}</pre>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              .writeText(command)
              .then(() => {
                setNotice("Commands copied.");
              })
              .catch(() => {
                setError(
                  "Clipboard unavailable. Select and copy the commands.",
                );
              });
          }}
        >
          Copy commands
        </Button>
        <p className="small mt-3">
          Use <code>--mode host</code> only when you intend to let tools run
          directly under your operating system account.
        </p>
      </details>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
