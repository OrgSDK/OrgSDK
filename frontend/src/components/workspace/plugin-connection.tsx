"use client";
import { useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { result, errorMessage } from "../../api/result";
import type { components } from "../../api/schema";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function PluginConnection({
  plugin,
  auth,
  onConnected,
}: {
  plugin: components["schemas"]["Plugin"];
  auth: components["schemas"]["PluginAuth"];
  onConnected: (credential: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(`${plugin.slug} connection`);
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!auth.provider) return null;
  const connect = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      if (auth.type === "oauth2") {
        const response = result(
          await api.POST("/api/v1/credentials/oauth-connect/", {
            body: {
              plugin: plugin.id,
              name,
              client_id: clientId,
              client_secret: clientSecret,
            },
          }),
        );
        setClientSecret("");
        location.assign(response.authorization_url);
        return;
      }
      const field = plugin.slug === "github" ? "secret_token" : "secret_apiKey";
      const credential = result(
        await api.POST("/api/v1/credentials/", {
          body: {
            name,
            provider: auth.provider ?? "",
            secret: { [field]: token },
          },
        }),
      );
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
            /api/v1/credentials/oauth-callback/
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
