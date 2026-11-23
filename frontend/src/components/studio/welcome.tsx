"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Monitor,
  RefreshCw,
  Server,
} from "lucide-react";
import {
  discover,
  isLocalAddress,
  localInstallations,
  requestApproval,
} from "../../api/studio";
import { OrgSdkWordmark } from "../workspace/brand";
import { InstallCommands } from "./install-commands";
import { StudioCacheStatus } from "./cache-status";
import "./welcome.css";

type View = "checking" | "install" | "choose" | "server";

interface ConnectionStart {
  address: string;
  error: string;
}

export function StudioWelcome({
  start,
}: {
  start: ConnectionStart | undefined;
}): ReactNode {
  return (
    <div className="studio-welcome">
      <header className="studio-masthead">
        <OrgSdkWordmark className="studio-wordmark" />
        <span>Studio</span>
      </header>
      <main className="studio-stage">
        {start ? (
          <ConnectionPanel start={start} />
        ) : (
          <section
            className="studio-window studio-window-body"
            aria-busy="true"
          >
            <h1>Opening Studio</h1>
          </section>
        )}
      </main>
      <footer className="studio-footer">
        <StudioCacheStatus showOfflineStatus />
      </footer>
    </div>
  );
}

function focusServerAddress(input: HTMLInputElement | null) {
  input?.focus();
}

function ConnectionPanel({ start }: { start: ConnectionStart }): ReactNode {
  const hasRemoteAddress =
    Boolean(start.address) && !isLocalAddress(start.address);
  const initialView = hasRemoteAddress || start.error ? "server" : "checking";
  const [search, setSearch] = useState(
    initialView === "checking" ? { address: start.address } : undefined,
  );
  const [view, setView] = useState<View>(initialView);
  const [matches, setMatches] = useState<string[]>([]);
  const [address, setAddress] = useState(start.address);
  const [error, setError] = useState(start.error);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  function newRequest() {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setError("");
    return request.signal;
  }

  useEffect(() => {
    const request = new AbortController();
    pending.current = request;
    if (search) {
      void localInstallations(search.address, request.signal)
        .then(async (found) => {
          if (request.signal.aborted) return;
          if (found.length === 1 && found[0]) {
            await requestApproval(found[0], request.signal);
            return;
          }
          setMatches(found);
          setView(found.length > 0 ? "choose" : "install");
        })
        .catch((error_: unknown) => {
          if (request.signal.aborted) return;
          setView("install");
          setError(
            error_ instanceof Error
              ? error_.message
              : "Could not start the connection.",
          );
        });
    }
    return () => {
      pending.current?.abort();
    };
  }, [search]);

  function tryLocal(preferred: string) {
    pending.current?.abort();
    setView("checking");
    setError("");
    setBusy(false);
    setSearch({ address: preferred });
  }

  async function connect(input: string) {
    const signal = newRequest();
    setBusy(true);
    try {
      await requestApproval(await discover(input, signal), signal);
    } catch (error_) {
      if (signal.aborted) return;
      setError(
        error_ instanceof Error
          ? error_.message
          : "Could not connect to this installation.",
      );
      setBusy(false);
    }
  }

  const isRemote = view === "server";
  return (
    <section className="studio-window" aria-labelledby="studio-heading">
      <div className="studio-titlebar">
        <span>
          {isRemote ? <Server /> : <Monitor />}
          {isRemote ? "Server connection" : "Local connection"}
        </span>
        <span role="status" className="studio-connection-status">
          {
            {
              checking: "Searching",
              install: "Not connected",
              choose: "Installations found",
              server: busy ? "Connecting" : "Not connected",
            }[view]
          }
        </span>
      </div>
      <div className="studio-window-body">
        {view === "checking" && (
          <>
            <h1 id="studio-heading">Finding your installation</h1>
            <p>
              Allow local network access if your browser asks. Studio will open
              your installation for approval.
            </p>
          </>
        )}
        {view === "install" && (
          <>
            <h1 id="studio-heading">Get started with Studio</h1>
            <p>
              Studio couldn’t reach OrgSDK on this computer. Run these commands
              in a terminal to install it and start your workspace.
            </p>
            <InstallCommands />
            <div className="studio-actions">
              <button
                className="studio-primary"
                onClick={() => {
                  tryLocal(search?.address ?? "");
                }}
              >
                <RefreshCw />
                Try connecting again
              </button>
              <a
                className="studio-guide"
                href="https://github.com/OrgSDK/OrgSDK/blob/main/docs/npm-distribution.md"
                target="_blank"
                rel="noreferrer"
              >
                Installation guide <ArrowUpRight />
              </a>
            </div>
            <p className="studio-hint">
              Already running? Allow local network access in your browser.
            </p>
          </>
        )}
        {view === "choose" && (
          <>
            <h1 id="studio-heading">Choose an installation</h1>
            <p>
              More than one copy of OrgSDK is running on this computer. Select
              the one you want to open.
            </p>
            <div className="studio-choices">
              {matches.map((endpoint) => (
                <button
                  key={endpoint}
                  disabled={busy}
                  onClick={() => void connect(endpoint)}
                >
                  {endpoint}
                  <ArrowRight />
                </button>
              ))}
            </div>
          </>
        )}
        {isRemote && (
          <>
            <h1 id="studio-heading">Connect to a server</h1>
            <p>
              Enter your installation’s address. You’ll approve the connection
              on that server.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void connect(address);
              }}
            >
              <label htmlFor="studio-server">Server address</label>
              <input
                id="studio-server"
                ref={focusServerAddress}
                type="url"
                required
                placeholder="https://workspace.example.com"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                }}
              />
              <button className="studio-primary" disabled={busy}>
                Connect to server <ArrowRight />
              </button>
            </form>
          </>
        )}
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        className="studio-switch"
        onClick={() => {
          if (isRemote) {
            tryLocal("");
            return;
          }
          pending.current?.abort();
          setError("");
          setBusy(false);
          setView("server");
        }}
      >
        {isRemote ? <Monitor /> : <Server />}
        {isRemote
          ? "Find OrgSDK on this computer"
          : "Connect to a different server"}
        <ArrowRight />
      </button>
    </section>
  );
}
