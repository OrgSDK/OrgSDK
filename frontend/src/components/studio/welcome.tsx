"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  findInstallations,
  requestApproval,
  studioClient,
  studioServerHref,
  type Installation,
} from "../../api/studio";
import {
  allowLocalAccess,
  isLocalAccessAllowed,
  rememberedGrant,
  resumeConnection,
  savedStudioServers,
} from "../../api/studio-session";
import { LocalSignIn } from "./local-sign-in";
import { OrgSdkWordmark } from "../workspace/brand";
import { InstallCommands } from "./install-commands";
import { StudioCacheStatus } from "./cache-status";
import "./welcome.css";

type View =
  "permission" | "account" | "checking" | "install" | "choose" | "server";

interface ConnectionStart {
  isSwitchingServer: boolean;
  address: string;
  error: string;
}

export function StudioWelcome({
  start,
  onConnected,
}: {
  start: ConnectionStart | undefined;
  onConnected: (expiresAt: number) => void;
}): ReactNode {
  return (
    <div className="studio-welcome">
      <header className="studio-masthead">
        <OrgSdkWordmark className="studio-wordmark" />
        <span>Studio</span>
      </header>
      <main className="studio-stage">
        {start ? (
          <ConnectionPanel start={start} onConnected={onConnected} />
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

function ConnectionPanel({
  start,
  onConnected,
}: {
  start: ConnectionStart;
  onConnected: (expiresAt: number) => void;
}): ReactNode {
  const [view, setView] = useState<View>(() => {
    if (start.isSwitchingServer || start.error) return "server";
    if (start.address && !isLocalAddress(start.address)) {
      return rememberedGrant(start.address) ? "checking" : "server";
    }
    return isLocalAccessAllowed() ? "checking" : "permission";
  });
  const [search, setSearch] = useState(
    view === "checking"
      ? { address: start.address, timeoutMs: 2500 }
      : undefined,
  );
  const [matches, setMatches] = useState<Installation[]>([]);
  const [savedServers] = useState(savedStudioServers);
  const [address, setAddress] = useState(start.address);
  const [account, setAccount] = useState<{
    endpoint: string;
    setup: boolean;
    signal: AbortSignal;
  }>();
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

  const select = useCallback(
    async (installation: Installation, signal: AbortSignal) => {
      const { endpoint } = installation;
      const grant = await resumeConnection(endpoint, signal);
      signal.throwIfAborted();
      if (grant) {
        onConnected(grant.expiresAt);
        return;
      }
      if (!installation.localSignIn) {
        await requestApproval(endpoint, signal);
        return;
      }
      const status = await studioClient(endpoint).auth.setupStatus.query(
        undefined,
        { signal },
      );
      signal.throwIfAborted();
      setAccount({ endpoint, setup: status.setup_required, signal });
      setView("account");
      setBusy(false);
    },
    [onConnected],
  );

  useEffect(() => {
    const request = new AbortController();
    pending.current = request;
    if (search) {
      void findInstallations(search.address, request.signal, search.timeoutMs)
        .then(async (found) => {
          if (request.signal.aborted) return;
          if (found.length === 1 && found[0]) {
            await select(found[0], request.signal);
            return;
          }
          setMatches(found);
          setView(found.length > 0 ? "choose" : "install");
        })
        .catch((error_: unknown) => {
          if (request.signal.aborted) return;
          setView(
            search.address && !isLocalAddress(search.address)
              ? "server"
              : "install",
          );
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
  }, [search, select]);

  function tryLocal(preferred: string) {
    allowLocalAccess();
    pending.current?.abort();
    setView("checking");
    setError("");
    setBusy(false);
    // Leave time for the browser’s first local-network permission prompt.
    setSearch({ address: preferred, timeoutMs: 60_000 });
  }

  async function connect(input: string) {
    const signal = newRequest();
    setBusy(true);
    try {
      const installation = await discover(input, signal);
      signal.throwIfAborted();
      if (isLocalAddress(installation.endpoint)) allowLocalAccess();
      await select(installation, signal);
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
              permission: "Not connected",
              account: "Installation found",
              checking: "Searching",
              install: "Not connected",
              choose: "Installations found",
              server: busy ? "Connecting" : "Not connected",
            }[view]
          }
        </span>
      </div>
      <div className="studio-window-body">
        {view === "permission" && (
          <>
            <h1 id="studio-heading">Connect to this computer</h1>
            <p>
              Allow Studio to look for OrgSDK on this computer and reconnect
              when you return.
            </p>
            <div className="studio-actions mt-4">
              <button
                className="studio-primary"
                onClick={() => {
                  tryLocal(start.address);
                }}
              >
                Allow local connections <ArrowRight />
              </button>
            </div>
          </>
        )}
        {view === "account" && account && (
          <LocalSignIn
            key={account.endpoint}
            endpoint={account.endpoint}
            signal={account.signal}
            needsSetup={account.setup}
            onConnected={onConnected}
            useInstallation={() => {
              void requestApproval(account.endpoint, account.signal).catch(
                (error_: unknown) => {
                  if (!account.signal.aborted)
                    setError(
                      error_ instanceof Error
                        ? error_.message
                        : "Could not open the installation.",
                    );
                },
              );
            }}
          />
        )}
        {view === "checking" && (
          <>
            <h1 id="studio-heading">Finding your installation</h1>
            <p>Allow local network access if your browser asks.</p>
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
              {matches.map(({ endpoint }) => (
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
            {savedServers.length > 0 && (
              <div className="studio-choices">
                <h2>Saved servers</h2>
                {savedServers.map(({ endpoint, name }) => (
                  <a key={endpoint} href={studioServerHref(endpoint)}>
                    <span className="min-w-0">
                      {name && <span className="block">{name}</span>}
                      <small>{endpoint}</small>
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </a>
                ))}
              </div>
            )}
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
            tryLocal(isLocalAddress(start.address) ? start.address : "");
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
