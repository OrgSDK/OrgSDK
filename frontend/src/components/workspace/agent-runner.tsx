"use client";
import { useState, useEffect, type ReactNode } from "react";
import type { components } from "../../api/schema";
import { api } from "../../api/client";
import { errorMessage, result, requireSuccess } from "../../api/result";
import { Button } from "../ui/button";
import { useDiscardConfirmation } from "./discard-dialog";

export function AgentRunner({
  agent,
  refresh,
}: {
  agent: Pick<components["schemas"]["Agent"], "id" | "runner">;
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
        requireSuccess(
          await api.DELETE("/api/v1/projects/{id}/executor/", {
            params: { path: { id: agent.id } },
          }),
        );
        setNotice("Runner access revoked.");
      } else {
        const registration = result(
          await api.POST("/api/v1/projects/{id}/executor/", {
            params: { path: { id: agent.id } },
            body: { locally_managed: isLocal },
          }),
        );
        if (isLocal)
          setNotice(
            "Local Docker runner enabled. It will connect automatically.",
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
    "orgsdk-executor register --url " +
    origin +
    "\norgsdk-executor start --mode docker";
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => {
      setNow(Date.now());
    };
    update();
    const timer = setInterval(update, 10_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const lastSeen = agent.runner.last_seen_at
    ? new Date(agent.runner.last_seen_at).getTime()
    : undefined;
  let registrationStatus = "Registered · waiting for connection";
  if (lastSeen !== undefined)
    registrationStatus =
      now - lastSeen > 60_000
        ? "Unavailable · no recent heartbeat"
        : "Available";
  if (!agent.runner.enabled) registrationStatus = "Revoked";
  return (
    <section className="panel">
      <h2>Project runner</h2>
      <p className="mb-4">
        This project uses its own runner to execute actions in its persistent
        working folder.
      </p>
      <p>
        {agent.runner.registered ? registrationStatus : "Not registered"} ·{" "}
        {agent.runner.locally_managed
          ? "Managed by local Docker Compose"
          : "Linked runner"}
      </p>
      {agent.runner.last_seen_at ? (
        <p className="small">
          Last connected: {new Date(agent.runner.last_seen_at).toLocaleString()}
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
          Use local Docker runner
        </Button>
        <Button
          variant="outline"
          disabled={busy || !agent.runner.registered || !agent.runner.enabled}
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
        <summary>Link an npm or Docker runner</summary>
        <p className="mt-4">
          Install the executor package from your installation’s runtime build
          with npm. It requires Node 22 and Bun 1.4. Docker mode also requires
          Docker and the executor image configured by your administrator.
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
