"use client";
import { useEffect, useState, type ReactNode } from "react";
import { trpc, type RouterOutputs } from "../../api/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  authModeOptions,
  authModeSchema,
  customHeadersSchema,
  transportOptions,
  transportSchema,
} from "./mcp-connection-options";

type Connection = RouterOutputs["plugins"]["mcp"]["get"];
export function McpConnectionSettings({
  connection,
  busy,
  perform,
  onDirtyChange,
}: {
  connection: Connection;
  busy: boolean;
  perform: (
    operation: () => Promise<unknown>,
    message?: string,
  ) => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [auth, setAuth] = useState(connection.authMode);
  const [transport, setTransport] = useState(connection.transport);
  const [token, setToken] = useState("");
  const [headers, setHeaders] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [metadataUrl, setMetadataUrl] = useState("");
  const isChanged =
    endpoint !== connection.endpoint ||
    auth !== connection.authMode ||
    transport !== connection.transport ||
    !!(token || headers);
  const isDirty = isChanged || !!(clientId || clientSecret || metadataUrl);
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => {
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);
  return (
    <div className="space-y-3">
      {connection.authMode === "oauth" ? (
        <div className="space-y-2">
          <details>
            <summary>Registered OAuth application (optional)</summary>
            <label className="block">
              Client ID
              <Input
                value={clientId}
                onChange={(event) => {
                  setClientId(event.target.value);
                }}
              />
            </label>
            <label className="block">
              Client secret
              <Input
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(event) => {
                  setClientSecret(event.target.value);
                }}
              />
            </label>
            <label className="block">
              Client metadata URL
              <Input
                type="url"
                value={metadataUrl}
                onChange={(event) => {
                  setMetadataUrl(event.target.value);
                }}
              />
            </label>
            <p className="small">
              Register <code>/oauth/mcp/callback</code> on your configured
              OrgSDK public origin as the callback URL.
            </p>
          </details>
          <Button
            disabled={busy || isChanged}
            onClick={() => {
              void perform(async () => {
                const result = await trpc.plugins.mcp.beginOAuth.mutate({
                  id: connection.pluginId,
                  ...(clientId && { client_id: clientId }),
                  ...(clientSecret && { client_secret: clientSecret }),
                  ...(metadataUrl && { client_metadata_url: metadataUrl }),
                });
                setClientId("");
                setClientSecret("");
                setMetadataUrl("");
                onDirtyChange(false);
                setAuthorizationUrl(result.authorization_url);
              }, "Open the sign-in link, finish authorization, then check the connection.");
            }}
          >
            {connection.authenticated ? "Reconnect account" : "Sign in"}
          </Button>
          {authorizationUrl ? (
            <a
              className="underline"
              href={authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Continue to server sign-in
            </a>
          ) : null}
        </div>
      ) : null}
      <details>
        <summary>Update connection</summary>
        <p>
          Saving disables this connection until its tools are checked and
          reviewed again.
        </p>
        <label className="block">
          Server URL
          <Input
            type="url"
            value={endpoint}
            onChange={(event) => {
              setEndpoint(event.target.value);
            }}
          />
        </label>
        <label className="block">
          Authentication
          <select
            className="field"
            value={auth}
            onChange={(event) => {
              setAuth(authModeSchema.parse(event.target.value));
            }}
          >
            {authModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {auth === "headers" ? (
          <>
            <label className="block">
              Replacement bearer token
              <Input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                }}
              />
            </label>
            <label className="block">
              Replacement custom headers (JSON)
              <Textarea
                value={headers}
                onChange={(event) => {
                  setHeaders(event.target.value);
                }}
                placeholder={'{"X-API-Key":"..."}'}
              />
            </label>
            <p className="small">
              Leave credential fields empty to keep existing credentials at the
              same endpoint.
            </p>
          </>
        ) : null}
        <label className="block">
          Connection transport
          <select
            className="field"
            value={transport}
            onChange={(event) => {
              setTransport(transportSchema.parse(event.target.value));
            }}
          >
            {transportOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={busy || !isChanged}
          onClick={() => {
            void perform(async () => {
              const custom = headers.trim()
                ? customHeadersSchema.parse(JSON.parse(headers))
                : {};
              await trpc.plugins.mcp.update.mutate({
                id: connection.pluginId,
                endpoint,
                transport,
                auth_mode: auth,
                ...(auth === "headers" &&
                  (token || headers) && {
                    headers: {
                      ...custom,
                      ...(token && { Authorization: `Bearer ${token}` }),
                    },
                  }),
              });
              setToken("");
              setHeaders("");
            });
          }}
        >
          Save connection changes
        </Button>
      </details>
    </div>
  );
}
