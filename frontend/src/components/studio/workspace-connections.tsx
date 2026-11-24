"use client";
import { useState, type ReactNode } from "react";
import { forgetConnection } from "../../api/studio-session";
import { errorMessage } from "../../api/result";
import { installationOrigin, trpc } from "../../api/trpc";
import { useDiscardConfirmation } from "../workspace/discard-dialog";
import { useWorkspace } from "../workspace/workspace-context";

export function StudioWorkspaceConnections(): ReactNode {
  const { isDirty } = useWorkspace();
  const canDiscard = useDiscardConfirmation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (isDirty && !(await canDiscard())) return;
    setBusy(true);
    try {
      await trpc.auth.logout.mutate();
      forgetConnection(installationOrigin());
      location.reload();
    } catch (error_) {
      setError(errorMessage(error_));
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2 px-4 py-2 text-sm">
      <a href="/?connect=server" target="_blank" rel="noopener noreferrer">
        Connect to a different server
      </a>
      <button className="w-fit" disabled={busy} onClick={() => void signOut()}>
        Sign out of Studio
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
