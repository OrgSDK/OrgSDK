"use client";
import { trpc } from "../../api/trpc";
import { useState, type ReactNode } from "react";
import { errorMessage } from "../../api/result";
import type { Plugin } from "../../api/types";
import type { PluginAuth } from "../../lib/plugin-tools";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function PluginConnection({
  plugin,
  auth,
  onConnected,
}: {
  plugin: Plugin;
  auth: PluginAuth;
  onConnected: (credential: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(`${plugin.slug} connection`);
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const provider = auth.provider;
  if (!provider) return null;
  const connect = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      if (auth.type === "oauth2") {
        const response = await trpc.credentials.beginOAuth.mutate({
          plugin: plugin.id,
          name,
          client_id: clientId,
          client_secret: clientSecret,
        });
        setClientSecret("");
        location.assign(response.authorization_url);
        return;
      }
      const field = plugin.slug === "github" ? "secret_token" : "secret_apiKey";
      const credential = await trpc.credentials.create.mutate({
        name,
        provider,
        secret: { [field]: token },
      });
      setToken("");
      // Keep the created credential visible even if assigning it needs a retry.
      await onConnected(credential.id);
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="my-4 rounded-lg border p-4">
      <summary>Connect {auth.label ?? plugin.slug}</summary>
      <label>
        Connection name
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          disabled={busy}
        />
      </label>
      {auth.type === "oauth2" ? (
        <>
          <p>Use your own OAuth application. Register this redirect URL:</p>
          <code className="break-all">
            {typeof window === "undefined" ? "" : location.origin}
            /oauth/callback
          </code>
          <label>
            Client ID
            <Input
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
              }}
              disabled={busy}
            />
          </label>
          <label>
            Client secret
            <Input
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(event) => {
                setClientSecret(event.target.value);
              }}
              disabled={busy}
            />
          </label>
        </>
      ) : (
        <label>
          {auth.label ?? "API token"}
          <Input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
            }}
            disabled={busy}
          />
        </label>
      )}
      <Button
        type="button"
        className="mt-3"
        disabled={
          busy ||
          !name.trim() ||
          (auth.type === "oauth2" ? !clientId || !clientSecret : !token)
        }
        onClick={() => {
          void connect();
        }}
      >
        Connect
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
