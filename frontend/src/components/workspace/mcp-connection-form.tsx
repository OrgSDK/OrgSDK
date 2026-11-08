"use client";
import { useEffect, useState, type ReactNode } from "react";
import { trpc, type RouterInputs } from "../../api/trpc";
import { errorMessage } from "../../api/result";
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

type ConnectionInput = RouterInputs["plugins"]["mcp"]["create"];
export function McpConnectionForm({
  project,
  onSaved,
  onDirtyChange,
}: {
  project: string;
  onSaved: () => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const [slug, setSlug] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [transport, setTransport] =
    useState<ConnectionInput["transport"]>("auto");
  const [auth, setAuth] = useState<ConnectionInput["auth_mode"]>("none");
  const [token, setToken] = useState("");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isDirty = !!(slug || endpoint || token || headers);
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => {
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          try {
            const custom = headers.trim()
              ? customHeadersSchema.parse(JSON.parse(headers))
              : {};
            await trpc.plugins.mcp.create.mutate({
              project,
              slug,
              endpoint,
              transport,
              auth_mode: auth,
              ...(auth === "headers" && {
                headers: {
                  ...custom,
                  ...(token && { Authorization: `Bearer ${token}` }),
                },
              }),
            });
            setSlug("");
            setEndpoint("");
            setToken("");
            setHeaders("");
            await onSaved();
          } catch (error_) {
            setError(errorMessage(error_));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h3>Connect MCP server</h3>
      <p>
        Add a server, check its connection, then choose the tools this project
        can use.
      </p>
      <label className="block">
        Connection name
        <Input
          required
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value);
          }}
          placeholder="customer-tools"
          pattern="[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*"
        />
      </label>
      <label className="block">
        Server URL
        <Input
          required
          type="url"
          value={endpoint}
          onChange={(event) => {
            setEndpoint(event.target.value);
          }}
          placeholder="https://example.com/mcp"
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
            Bearer token
            <Input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
              }}
            />
          </label>
          <details>
            <summary>Custom authentication headers</summary>
            <label className="block">
              Headers as a JSON object
              <Textarea
                value={headers}
                onChange={(event) => {
                  setHeaders(event.target.value);
                }}
                placeholder={'{"X-API-Key":"..."}'}
              />
            </label>
          </details>
        </>
      ) : null}
      <details>
        <summary>Transport settings</summary>
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
      </details>
      {error ? <p role="alert">{error}</p> : null}
      <Button disabled={busy} type="submit">
        {busy ? "Saving…" : "Add connection"}
      </Button>
    </form>
  );
}
