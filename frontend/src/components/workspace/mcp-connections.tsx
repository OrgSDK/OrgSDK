"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Plugin } from "../../api/types";
import { McpConnectionCard } from "./mcp-connection-card";
import { McpConnectionForm } from "./mcp-connection-form";
export function McpConnections({
  project,
  plugins,
  canManage,
  onChanged,
  onDirtyChange,
}: {
  project: string;
  plugins: Plugin[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const [dirtyEntries, setDirtyEntries] = useState<Record<string, boolean>>({});
  const isDirty = Object.values(dirtyEntries).some(Boolean);
  const changeDirty = useCallback((id: string, isDirty: boolean) => {
    setDirtyEntries((entries) =>
      entries[id] === isDirty ? entries : { ...entries, [id]: isDirty },
    );
  }, []);
  const formDirty = useCallback(
    (isDirty: boolean) => {
      changeDirty("create", isDirty);
    },
    [changeDirty],
  );
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => {
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);
  return (
    <section className="panel space-y-4">
      <h2>Remote MCP connections</h2>
      <p>
        Use tools from your own servers in this project’s code and actions.
        Connections run from the project runner.
      </p>
      {plugins.map((plugin) => (
        <McpConnectionCard
          key={plugin.id}
          plugin={plugin}
          canManage={canManage}
          onChanged={onChanged}
          onDirtyChange={changeDirty}
        />
      ))}
      {canManage ? (
        <McpConnectionForm
          key={project}
          project={project}
          onSaved={onChanged}
          onDirtyChange={formDirty}
        />
      ) : (
        <p>Ask an administrator to connect a server or change tool access.</p>
      )}
    </section>
  );
}
