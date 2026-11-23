"use client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { AccountShell } from "../accounts/account-shell";
import {
  finishApproval,
  localInstallations,
  requestApproval,
  suggestedInstallation,
} from "../../api/studio";
export function StudioConnection({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [connected, setConnected] = useState(false);
  const [expired, setExpired] = useState(false);
  const [input, setInput] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resume = useRef<ReturnType<typeof finishApproval> | null>(null);
  useEffect(() => {
    let isActive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    resume.current ??= finishApproval();
    void resume.current
      .then((expiry) => {
        if (!isActive) return;
        setInput(suggestedInstallation());
        if (expiry === false) return;
        setConnected(true);
        timer = setTimeout(
          () => {
            setExpired(true);
          },
          Math.max(0, expiry - Date.now()),
        );
      })
      .catch((error_: unknown) => {
        if (isActive)
          setError(
            error_ instanceof Error ? error_.message : "Connection failed.",
          );
      });
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, []);
  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }
  if (connected)
    return (
      <>
        {expired && (
          <aside role="alert" className="panel">
            <p>
              Your dashboard session has expired. Copy any unsaved edits before
              reconnecting.
            </p>
            <Button
              onClick={() => {
                location.reload();
              }}
            >
              Reconnect
            </Button>
          </aside>
        )}
        {children}
      </>
    );
  return (
    <AccountShell
      title="Connect to OrgSDK"
      description="Choose the computer or hosted installation that owns your workspace."
    >
      <Button
        disabled={busy}
        type="button"
        onClick={() =>
          void attempt(async () => {
            const found = await localInstallations();
            setMatches(found);
            if (found.length === 0)
              throw new Error(
                "No compatible local installation responded. Start OrgSDK and allow this site to connect to your computer, or open the local address printed by OrgSDK.",
              );
            if (found.length === 1 && found[0]) await requestApproval(found[0]);
          })
        }
      >
        Connect to this computer
      </Button>
      {matches.length > 1 && (
        <section>
          <h2>Choose an installation</h2>
          {matches.map((endpoint) => (
            <Button
              key={endpoint}
              disabled={busy}
              onClick={() => void attempt(() => requestApproval(endpoint))}
            >
              {endpoint}
            </Button>
          ))}
        </section>
      )}
      <form
        className="mt-6 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void attempt(() => requestApproval(input));
        }}
      >
        <label className="block">
          Server address
          <Input
            type="url"
            required
            value={input}
            placeholder="https://workspace.example.com"
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
        </label>
        <Button variant="outline" disabled={busy} type="submit">
          Connect to server
        </Button>
      </form>
      {busy && <p role="status">Connecting…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </AccountShell>
  );
}
