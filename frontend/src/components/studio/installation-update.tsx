"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isTRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../../../server/router";
import { trpc, installationOrigin, type RouterOutputs } from "../../api/trpc";
import { isLocalAddress } from "../../api/studio";
import { Button } from "../ui/button";

type Status = RouterOutputs["system"]["updateStatus"];
const guide =
  "https://github.com/OrgSDK/OrgSDK/blob/main/docs/npm-distribution.md#lifecycle-and-recovery";
function remembered(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function progress(
  target: string,
  status: Status | undefined,
  isDisconnected: boolean,
) {
  if (isDisconnected)
    return (
      "Waiting for OrgSDK " +
      target +
      " to reconnect. If it stays offline, check the terminal where OrgSDK started."
    );
  if (status?.installed === target) {
    return status.executorReady
      ? "OrgSDK " +
          target +
          " is running and its local executor manager has reconnected."
      : "OrgSDK " +
          target +
          " is running. Waiting for the local executor manager…";
  }
  if (status && !status.pending && status.failed !== target)
    return (
      "The installation is running OrgSDK " +
      status.installed +
      ". The requested update is no longer in progress."
    );
  return status?.failed === target && !status.pending
    ? "The update failed. OrgSDK " +
        status.installed +
        " is running. See the launcher output for the cause and backup location."
    : "Updating to OrgSDK " +
        target +
        ". Active runs finish first, then OrgSDK backs up and restarts.";
}

export function InstallationUpdate({
  hasUnsavedChanges,
}: {
  hasUnsavedChanges: boolean;
}): ReactNode {
  const endpoint = installationOrigin();
  const storageKey = "orgsdk:update:" + endpoint;
  const [status, setStatus] = useState<Status>();
  const [legacy, setLegacy] = useState(false);
  const [target, setTarget] = useState(() => remembered(storageKey));
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(() =>
    remembered(storageKey + ":later"),
  );
  const [confirming, setConfirming] = useState(false);
  const [isDisconnected, setDisconnected] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const scope = new AbortController();
    let isChecking = false;
    async function check() {
      if (isChecking) return;
      isChecking = true;
      try {
        const next = await trpc.system.updateStatus.query(undefined, {
          signal: scope.signal,
        });
        if (scope.signal.aborted) return;
        setStatus(next);
        setDisconnected(false);
        setLegacy(false);
        if (next.pending) setTarget(next.pending);
      } catch (error) {
        if (scope.signal.aborted) return;
        if (
          isTRPCClientError<AppRouter>(error) &&
          error.data?.code === "NOT_FOUND"
        )
          setLegacy(true);
        else setDisconnected(true);
      } finally {
        isChecking = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), target ? 3000 : 3_600_000);
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      scope.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [target, endpoint]);
  function later(version: string) {
    setDismissed(version);
    setConfirming(false);
    setTarget("");
    setMessage("");
    try {
      sessionStorage.removeItem(storageKey);
      sessionStorage.setItem(storageKey + ":later", version);
    } catch {
      // The dismissal still applies in this tab.
    }
  }
  async function update(version: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setMessage("");
    try {
      await trpc.system.requestUpdate.mutate({ version });
      setStatus((current) => current && { ...current, pending: version });
      setTarget(version);
      setConfirming(false);
      try {
        sessionStorage.setItem(storageKey, version);
      } catch {
        // The current tab can still follow progress.
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not confirm the update. Check the installation before retrying.",
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  if (target) {
    const isComplete =
      status?.installed === target && status.executorReady && !isDisconnected;
    const hasStopped =
      !!status &&
      !isDisconnected &&
      !status.pending &&
      status.installed !== target;
    return (
      <aside className="panel" role="status">
        <p>{progress(target, status, isDisconnected)}</p>
        {(isComplete || hasStopped) && (
          <Button
            onClick={() => {
              later(isComplete ? target : "");
            }}
          >
            Dismiss
          </Button>
        )}
        {isDisconnected && (
          <Button
            onClick={() => {
              location.reload();
            }}
          >
            Reconnect to installation
          </Button>
        )}
      </aside>
    );
  }
  const version = status?.available ?? (legacy ? "legacy" : "");
  if (!version || version === dismissed) return null;
  return (
    <aside className="panel" aria-label="Installation update">
      <p>
        {legacy
          ? "This installation needs a manual upgrade to enable update checks in Studio."
          : "OrgSDK " +
            version +
            " is available. This installation is running " +
            (status?.installed ?? "") +
            "."}
      </p>
      {confirming && (
        <p>
          Save your work. OrgSDK will finish active runs, back up your database,
          key and project files, and briefly disconnect while restarting.
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      {!legacy && status?.automatic ? (
        <Button
          disabled={sending || (confirming && hasUnsavedChanges)}
          onClick={() => {
            if (confirming) void update(version);
            else setConfirming(true);
          }}
        >
          {confirming ? "Confirm update and restart" : "Update and restart"}
        </Button>
      ) : (
        <>
          <a href={guide} target="_blank" rel="noreferrer">
            View installation upgrade steps
          </a>
          {legacy && isLocalAddress(endpoint) && (
            <p>
              For an npm installation, stop OrgSDK and back up its data, run{" "}
              <code>npm install -g @orgsdk/cli@latest</code>, then start it
              again with the same settings.
            </p>
          )}
        </>
      )}
      <Button
        disabled={sending}
        variant="outline"
        onClick={() => {
          later(version);
        }}
      >
        Later
      </Button>
    </aside>
  );
}
