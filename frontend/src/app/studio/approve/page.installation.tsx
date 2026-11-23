"use client";
import { Button } from "../../../components/ui/button";
import { type ReactNode, useEffect, useState } from "react";
import { AccountShell } from "../../../components/accounts/account-shell";
import { trpc } from "../../../api/trpc";
export default function ApproveStudio(): ReactNode {
  const [audience, setAudience] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"loading" | "setup" | "login" | "ready">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const init = async () => {
      if (!/^[a-f0-9]{64}$/.test(location.hash.slice(1)))
        throw new Error("Start this connection from your dashboard.");
      const { audience } = await trpc.studio.discover.query();
      setAudience(audience);
      const setup = await trpc.auth.setupStatus.query();
      if (setup.setup_required) {
        setStatus("setup");
        return;
      }
      const session = await trpc.auth.browserSession.query();
      setStatus(session.is_authenticated ? "ready" : "login");
    };
    void init().catch((error_: unknown) => {
      setError(error_ instanceof Error ? error_.message : "Unable to connect.");
    });
  }, []);
  return (
    <AccountShell
      title="Approve dashboard access"
      description={
        audience
          ? "Allow " +
            audience +
            " to use your signed-in workspace for 30 minutes."
          : ""
      }
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status === "setup" && (
        <p>
          <a href="/setup/" target="_blank" rel="noreferrer">
            Set up this installation
          </a>
          , then reload this page.
        </p>
      )}
      {status === "login" && (
        <a
          href={
            "/accounts/login/?next=" +
            encodeURIComponent(location.pathname + location.hash)
          }
        >
          Sign in to this installation
        </a>
      )}
      {status === "ready" && (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void trpc.studio.approve
              .mutate({ challenge: location.hash.slice(1) })
              .then((reply) => {
                location.replace(
                  reply.audience + "/#code=" + encodeURIComponent(reply.code),
                );
              })
              .catch((error_: unknown) => {
                setBusy(false);
                setError(
                  error_ instanceof Error
                    ? error_.message
                    : "Unable to approve.",
                );
              });
          }}
        >
          Approve connection
        </Button>
      )}
    </AccountShell>
  );
}
