"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isTRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../../../server/router";
import { trpc, installationOrigin, type RouterOutputs } from "../../api/trpc";
import { isLocalAddress } from "../../api/studio";
import { Button } from "../ui/button";
import {
  InstallationUpdateDialog,
  type UpdatePhase,
} from "./installation-update-dialog";

type Status = RouterOutputs["system"]["updateStatus"];
type Observation =
  | { connection: "online"; status: Status; healthReady: boolean }
  | { connection: "offline" | "sign-in" | "legacy" };

const upgradeGuide =
  "https://github.com/OrgSDK/OrgSDK/blob/main/docs/npm-distribution.md#lifecycle-and-recovery";

function remembered(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function remember(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // The update can still be followed in this tab.
  }
}

function updatePhase(
  target: string,
  observation: Observation | undefined,
  isSending: boolean,
): UpdatePhase {
  if (isSending) return "requesting";
  if (!observation) return "checking";
  if (observation.connection === "sign-in") return "sign-in";
  if (observation.connection !== "online") return "reconnecting";
  const { status, healthReady } = observation;
  if (status.installed === target)
    return healthReady && status.executorReady ? "complete" : "verifying";
  if (status.pending === target) {
    const blockers = status.blockers;
    // Installations that predate blocker counts still report when an update is pending.
    return !blockers || blockers.running + blockers.awaitingApproval > 0
      ? "waiting"
      : "restarting";
  }
  return "stopped";
}

async function isPlatformHealthy(signal: AbortSignal): Promise<boolean> {
  try {
    const health = await trpc.system.health.query(undefined, { signal });
    return health.status === "ok";
  } catch {
    return false;
  }
}

async function observe(
  target: string,
  signal: AbortSignal,
): Promise<Observation> {
  try {
    const status = await trpc.system.updateStatus.query(undefined, { signal });
    const isHealthReady =
      status.installed === target && (await isPlatformHealthy(signal));
    return { connection: "online", status, healthReady: isHealthReady };
  } catch (error) {
    if (isTRPCClientError<AppRouter>(error)) {
      if (error.data?.code === "UNAUTHORIZED") return { connection: "sign-in" };
      if (error.data?.code === "NOT_FOUND") return { connection: "legacy" };
    }
    return { connection: "offline" };
  }
}

export function InstallationUpdate({
  hasUnsavedChanges,
  onReviewApprovals,
}: {
  hasUnsavedChanges: boolean;
  onReviewApprovals: () => void;
}): ReactNode {
  const endpoint = installationOrigin();
  const storageKey = "orgsdk:update:" + endpoint;
  const dismissedKey = storageKey + ":later";
  const [observation, setObservation] = useState<Observation>();
  const [target, setTarget] = useState(() => remembered(storageKey));
  const [dismissed, setDismissed] = useState(() => remembered(dismissedKey));
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setSending] = useState(false);
  const [reviewingApprovals, setReviewingApprovals] = useState(false);
  const inFlight = useRef(false);
  const checkNow = useRef<() => void>(undefined);
  const noticeButton = useRef<HTMLButtonElement>(null);
  const phase = target
    ? updatePhase(target, observation, isSending)
    : "confirm";
  const isSettled = phase === "complete" || phase === "stopped";
  const status =
    observation?.connection === "online" ? observation.status : undefined;
  const isLegacy = observation?.connection === "legacy";
  const isReviewing = reviewingApprovals && phase === "waiting";

  useEffect(() => {
    if (isSending || isSettled) return;
    const scope = new AbortController();
    let isChecking = false;
    async function check() {
      if (isChecking) return;
      isChecking = true;
      const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(8000)]);
      const next = await observe(target, signal);
      isChecking = false;
      if (scope.signal.aborted || inFlight.current) return;
      setObservation(next);
      const pending = next.connection === "online" ? next.status.pending : null;
      if (target || !pending) return;
      setTarget(pending);
      remember(storageKey, pending);
    }
    const whenVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    checkNow.current = () => void check();
    void check();
    const timer = setInterval(() => void check(), target ? 3000 : 3_600_000);
    document.addEventListener("visibilitychange", whenVisible, {
      signal: scope.signal,
    });
    addEventListener("online", whenVisible, { signal: scope.signal });
    return () => {
      scope.abort();
      clearInterval(timer);
      checkNow.current = undefined;
    };
  }, [target, storageKey, isSending, isSettled]);

  function later(version: string) {
    setDismissed(version);
    remember(dismissedKey, version);
  }

  function close() {
    if (phase === "complete") later(target);
    setTarget("");
    remember(storageKey, "");
    setConfirmation("");
    setMessage("");
    setReviewingApprovals(false);
  }

  async function update(version: string) {
    if (hasUnsavedChanges || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setMessage("");
    setTarget(version);
    remember(storageKey, version);
    try {
      await trpc.system.requestUpdate.mutate(
        { version },
        { signal: AbortSignal.timeout(8000) },
      );
      setObservation(undefined);
      setConfirmation("");
    } catch (error) {
      if (isTRPCClientError<AppRouter>(error) && error.data) {
        setTarget("");
        remember(storageKey, "");
        setMessage(error.message);
      } else {
        // The launcher may have received the request before the connection dropped.
        setObservation(undefined);
        setConfirmation("");
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  const version = status?.available ?? (isLegacy ? "legacy" : "");
  const canShowOffer =
    !target && !confirmation && version !== "" && version !== dismissed;
  return (
    <>
      {(canShowOffer || isReviewing) && (
        <aside
          className="panel flex flex-wrap items-center gap-x-4 gap-y-2"
          aria-label="Installation update"
        >
          {isReviewing ? (
            <>
              <p>OrgSDK {target} will update after the active runs finish.</p>
              <Button
                ref={noticeButton}
                variant="outline"
                onClick={() => {
                  setReviewingApprovals(false);
                }}
              >
                View update progress
              </Button>
            </>
          ) : (
            <>
              <p>
                {isLegacy
                  ? "This installation needs a manual upgrade to enable update checks in Studio."
                  : `OrgSDK ${version} is available. You’re running ${status?.installed ?? ""}.`}
              </p>
              {!isLegacy && status?.automatic ? (
                <Button
                  ref={noticeButton}
                  onClick={() => {
                    setConfirmation(version);
                  }}
                >
                  Click here to update
                </Button>
              ) : (
                <a href={upgradeGuide} target="_blank" rel="noreferrer">
                  View installation upgrade steps
                </a>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  later(version);
                }}
              >
                Later
              </Button>
              {isLegacy && isLocalAddress(endpoint) && (
                <p>
                  For an npm installation, stop OrgSDK and back up its data, run{" "}
                  <code>npm install -g @orgsdk/cli@latest</code>, then start it
                  again with the same settings.
                </p>
              )}
            </>
          )}
        </aside>
      )}
      <InstallationUpdateDialog
        open={Boolean(confirmation || target) && !isReviewing}
        phase={phase}
        version={target || confirmation}
        status={status}
        hasPassedHealthCheck={
          observation?.connection === "online" && observation.healthReady
        }
        hasUnsavedChanges={hasUnsavedChanges}
        message={message}
        onUpdate={() => void update(confirmation)}
        onClose={close}
        onAfterClose={() => {
          const fallback = document.querySelector<HTMLElement>(
            ".workspace-sidebar a[aria-current='page']",
          );
          (noticeButton.current ?? fallback)?.focus();
        }}
        onCheck={() => checkNow.current?.()}
        onReviewApprovals={() => {
          setReviewingApprovals(true);
          onReviewApprovals();
        }}
      />
    </>
  );
}
