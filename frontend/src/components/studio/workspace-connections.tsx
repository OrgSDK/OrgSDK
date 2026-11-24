"use client";
import { ArrowRight, ChevronsUpDown, Server, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { studioServerHref } from "../../api/studio";
import {
  forgetConnection,
  removeSavedStudioServer,
  savedStudioServers,
} from "../../api/studio-session";
import { errorMessage } from "../../api/result";
import { installationOrigin, trpc } from "../../api/trpc";
import { Button } from "../ui/button";
import { useDiscardConfirmation } from "../workspace/discard-dialog";
import { leaveWorkspaceAfterConfirmation } from "../workspace/use-unsaved-changes";
import { useWorkspace } from "../workspace/workspace-context";
import { StudioCacheStatus } from "./cache-status";

export function StudioWorkspaceConnections(): ReactNode {
  const { workspace, isDirty } = useWorkspace();
  const endpoint = installationOrigin();
  const canDiscard = useDiscardConfirmation();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [servers, setServers] = useState(savedStudioServers);
  const [isOpen, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const currentServer = { endpoint, name: workspace };
  const otherServers = servers.filter((server) => server.endpoint !== endpoint);

  useEffect(() => {
    function syncServers() {
      setServers(savedStudioServers());
    }
    addEventListener("storage", syncServers);
    return () => {
      removeEventListener("storage", syncServers);
    };
  }, []);

  function openDialog() {
    setServers(savedStudioServers());
    dialog.current?.showModal();
    setOpen(true);
    closeButton.current?.focus();
  }

  async function canLeave() {
    if (!isDirty) return true;
    // The workspace's discard dialog needs to take focus outside this popup.
    dialog.current?.close();
    if (await canDiscard()) return true;
    openDialog();
    return false;
  }

  async function switchServer(server: string) {
    if (await canLeave())
      leaveWorkspaceAfterConfirmation(studioServerHref(server));
  }

  async function removeServer(server: string) {
    if (server === endpoint && !(await canLeave())) return;
    setError("");
    try {
      removeSavedStudioServer(server);
      if (server === endpoint) {
        leaveWorkspaceAfterConfirmation("/?connect=server");
        return;
      }
      setServers(savedStudioServers());
      closeButton.current?.focus();
    } catch {
      setError("Studio couldn’t remove the saved server from this browser.");
      openDialog();
    }
  }

  async function signOut() {
    if (!(await canLeave())) return;
    setError("");
    setBusy(true);
    try {
      await trpc.auth.logout.mutate();
      forgetConnection(endpoint);
      leaveWorkspaceAfterConfirmation();
    } catch (error_) {
      setError(errorMessage(error_));
      setBusy(false);
      openDialog();
    }
  }

  return (
    <>
      <button
        type="button"
        className="workspace-label w-full text-left hover:bg-accent"
        aria-haspopup="dialog"
        aria-controls={titleId + "-dialog"}
        aria-expanded={isOpen}
        aria-label={"Saved servers for " + workspace}
        onClick={openDialog}
      >
        <span className="workspace-avatar" aria-hidden="true">
          {workspace.slice(0, 1).toUpperCase()}
        </span>
        <span>
          {workspace}
          <small>{endpoint}</small>
        </span>
        <ChevronsUpDown
          size={16}
          className="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>
      <dialog
        ref={dialog}
        id={titleId + "-dialog"}
        aria-labelledby={titleId}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-border bg-background text-foreground shadow-lg backdrop:bg-black/40"
        onClose={(event) => {
          setOpen(event.currentTarget.open);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="grid gap-4 p-4 sm:p-6">
          <header className="flex items-center justify-between gap-4">
            <h2 className="m-0" id={titleId}>
              Saved servers
            </h2>
            <Button
              type="button"
              ref={closeButton}
              variant="ghost"
              size="icon"
              aria-label="Close saved servers"
              onClick={() => dialog.current?.close()}
            >
              <X size={18} aria-hidden="true" />
            </Button>
          </header>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {[currentServer, ...otherServers].map((server) => {
              const isCurrent = server.endpoint === endpoint;
              const label = server.name
                ? `${server.name} (${server.endpoint})`
                : server.endpoint;
              return (
                <li
                  key={server.endpoint}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"
                >
                  <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                    {server.name && <strong>{server.name}</strong>}
                    <small className="block text-xs text-muted-foreground">
                      {server.endpoint}
                    </small>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {isCurrent ? (
                      <span className="px-2 text-xs font-medium text-accent-foreground">
                        Connected
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={"Switch to " + label}
                        onClick={() => void switchServer(server.endpoint)}
                      >
                        Switch
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={"Remove " + label}
                      onClick={() => void removeServer(server.endpoint)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <StudioCacheStatus hasUnsavedChanges={isDirty} />
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <Button asChild variant="ghost">
              <a
                href="/?connect=server"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Server size={16} aria-hidden="true" />
                Connect to a different server
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void signOut()}
            >
              Sign out of Studio
            </Button>
          </footer>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
