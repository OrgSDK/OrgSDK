import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type {
  ApprovedTool,
  Discovery,
} from "../../../runtime/src/mcp/contract";
import { plugins } from "./plugins";
import { workspaces } from "./core";

export const mcpConnections = sqliteTable("mcp_connections", {
  pluginId: text("plugin_id")
    .primaryKey()
    .references((): AnySQLiteColumn => plugins.id, { onDelete: "cascade" }),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  transport: text("transport", { enum: ["auto", "streamable-http", "sse"] })
    .notNull()
    .default("auto"),
  authMode: text("auth_mode", { enum: ["none", "headers", "oauth"] })
    .notNull()
    .default("none"),
  revision: integer("revision").notNull().default(0),
  catalogue: text("catalogue", { mode: "json" })
    .notNull()
    .$type<ApprovedTool[]>()
    .default([]),
  enabledTools: text("enabled_tools", { mode: "json" })
    .notNull()
    .$type<string[]>()
    .default([]),
  aliases: text("aliases", { mode: "json" })
    .notNull()
    .$type<Record<string, string>>()
    .default({}),
  candidate: text("candidate", { mode: "json" }).$type<Discovery>(),
  discoveryRunId: text("discovery_run_id"),
  status: text("status").notNull().default("unchecked"),
  checkedAt: text("checked_at"),
});
