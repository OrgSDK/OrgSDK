"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { trpc } from "../../api/trpc";
import type { Plugin } from "../../api/types";
import { errorMessage } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { Button } from "../ui/button";
import { McpConnectionSettings } from "./mcp-connection-settings";
import { ResourceState } from "./resource-state";

export function McpConnectionCard({
  plugin,
  canManage,
  onChanged,
  onDirtyChange,
}: {
  plugin: Plugin;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onDirtyChange: (id: string, isDirty: boolean) => void;
}): ReactNode {
  const load = useCallback(
    (signal: AbortSignal) =>
      trpc.plugins.mcp.get.query({ id: plugin.id }, { signal }),
    [plugin.id],
  );
  const query = useWorkspaceQuery(load);
  const refresh = query.refresh;
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const isDirty = settingsDirty || selected !== null;
  useEffect(() => {
    onDirtyChange(plugin.id, isDirty);
    return () => {
      onDirtyChange(plugin.id, false);
    };
  }, [plugin.id, isDirty, onDirtyChange]);
  const connection = query.data;
  useEffect(() => {
    if (connection?.status !== "checking") return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [connection?.status, refresh]);
  const perform = async (operation: () => Promise<unknown>, message = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      await query.refresh();
      await onChanged();
      setNotice(message);
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  const candidate = connection?.candidate;
  const defaults =
    candidate?.tools
      .filter(
        (tool) =>
          connection?.enabledTools.includes(tool.name) &&
          connection.catalogue.some((old) => {
            const { alias: _alias, ...previous } = old;
            return JSON.stringify(previous) === JSON.stringify(tool);
          }),
      )
      .map((tool) => tool.name) ?? [];
  const chosen = selected ?? defaults;
  const reviewLabel = (name: string): string => {
    if (defaults.includes(name)) return "Enabled, unchanged";
    return connection?.catalogue.some((tool) => tool.name === name)
      ? "Review changes"
      : "New tool";
  };
  return (
    <article
      className="rounded-lg border p-4 space-y-3"
      aria-label={`MCP ${plugin.slug}`}
    >
      <h3>{plugin.slug}</h3>
      <ResourceState {...query} />
      {connection ? (
        <>
          <p className="break-all small">{connection.endpoint}</p>
          <p>
            {plugin.enabled ? "Enabled" : "Disabled"} ·{" "}
            {connection.enabledTools.length} tools selected
          </p>
          {connection.runner === "ready" ? null : (
            <p role="status">
              {connection.runner === "offline"
                ? "Connect the project runner to check or use this server."
                : "Upgrade the project runner to enable MCP connections."}
            </p>
          )}
          {connection.status === "checking" ? (
            <p role="status">
              {connection.discovery?.status === "queued"
                ? "Waiting for the project runner…"
                : "Checking connection and available tools…"}
            </p>
          ) : null}
          {connection.status === "authentication_required" ? (
            <p role="status">
              This server requires authentication. Sign in or update its
              credentials.
            </p>
          ) : null}
          {connection.status === "failed" ? (
            <p role="alert">
              Connection check failed. {connection.discovery?.error}
            </p>
          ) : null}
          {connection.checkedAt ? (
            <p className="small">
              Last checked {new Date(connection.checkedAt).toLocaleString()}
            </p>
          ) : null}
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  busy ||
                  connection.runner !== "ready" ||
                  connection.status === "checking"
                }
                onClick={() => {
                  setSelected(null);
                  void perform(() =>
                    trpc.plugins.mcp.discover.mutate({ id: plugin.id }),
                  );
                }}
              >
                Check connection / refresh tools
              </Button>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  (!plugin.enabled && connection.enabledTools.length === 0)
                }
                onClick={() => {
                  void perform(
                    () =>
                      trpc.plugins.update.mutate({
                        id: plugin.id,
                        enabled: !plugin.enabled,
                      }),
                    plugin.enabled
                      ? "Connection disabled. Active runs are being cancelled."
                      : "Connection enabled.",
                  );
                }}
              >
                {plugin.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void perform(() =>
                    trpc.plugins.delete.mutate({ id: plugin.id }),
                  );
                }}
              >
                Remove
              </Button>
            </div>
          ) : null}
          {candidate && !candidate.authRequired ? (
            <div className="space-y-2">
              <h4>Review available tools</h4>
              <p>
                Only selected tools become available to this project. Changed
                tools need your review again.
              </p>
              {candidate.tools.map((tool) => (
                <div className="block rounded border p-2" key={tool.name}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={!canManage || busy}
                      checked={chosen.includes(tool.name)}
                      onChange={(event) => {
                        setSelected(
                          event.target.checked
                            ? [...chosen, tool.name]
                            : chosen.filter((name) => name !== tool.name),
                        );
                      }}
                    />{" "}
                    <strong>{tool.name}</strong>
                  </label>
                  <span className="small">{reviewLabel(tool.name)}</span>
                  <p className="small">{tool.description}</p>
                  <details>
                    <summary>Tool contract</summary>
                    <pre className="overflow-auto">
                      {JSON.stringify(
                        {
                          inputSchema: tool.inputSchema,
                          outputSchema: tool.outputSchema,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              ))}
              {connection.enabledTools.some((name) =>
                candidate.tools.every((tool) => tool.name !== name),
              ) ? (
                <p role="status">
                  Removed by the server:{" "}
                  {connection.enabledTools
                    .filter((name) =>
                      candidate.tools.every((tool) => tool.name !== name),
                    )
                    .join(", ")}
                  . Accepting this catalogue removes their access and cancels
                  affected runs.
                </p>
              ) : null}
              {candidate.tools.length === 0 ? (
                <p>This server exposes no tools.</p>
              ) : null}
              {canManage ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    const run = connection.discoveryRunId;
                    if (!run) return;
                    void perform(async () => {
                      await trpc.plugins.mcp.accept.mutate({
                        id: plugin.id,
                        run,
                        tools: chosen,
                      });
                      setSelected(null);
                    }, "Selected tools are ready for code and actions.");
                  }}
                >
                  Enable selected tools
                </Button>
              ) : null}
            </div>
          ) : null}
          {connection.catalogue.length > 0 ? (
            <details>
              <summary>Enabled tool reference</summary>
              {connection.catalogue
                .filter((tool) => connection.enabledTools.includes(tool.name))
                .map((tool) => (
                  <div key={tool.name}>
                    <code>
                      {plugin.slug.replaceAll(
                        /-([a-z])/g,
                        (_, letter: string) => letter.toUpperCase(),
                      )}
                      .{tool.alias}(args)
                    </code>
                    <pre className="overflow-auto">
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  </div>
                ))}
            </details>
          ) : null}
          {canManage ? (
            <McpConnectionSettings
              key={connection.revision}
              connection={connection}
              busy={busy}
              perform={perform}
              onDirtyChange={setSettingsDirty}
            />
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </article>
  );
}
