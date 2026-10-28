import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { workspaces } from "./core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .default(sql`1`),
  readableTables: text("readable_tables", { mode: "json" })
    .notNull()
    .$type<string[]>()
    .default(sql`'[]'`),
  writableTables: text("writable_tables", { mode: "json" })
    .notNull()
    .$type<string[]>()
    .default(sql`'[]'`),
  readableDocuments: text("readable_documents", { mode: "json" })
    .notNull()
    .$type<string[]>()
    .default(sql`'[]'`),
  writableDocuments: text("writable_documents", { mode: "json" })
    .notNull()
    .$type<string[]>()
    .default(sql`'[]'`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const executors = sqliteTable(
  "executors",
  {
    id: text("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pool: text("pool")
      .notNull()
      .default(sql`'shared'`),
    tokenHash: text("token_hash").notNull(),
    registrationNonce: text("registration_nonce").notNull(),
    locallyManaged: integer("locally_managed", { mode: "boolean" })
      .notNull()
      .default(sql`0`),
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    protocolVersion: integer("protocol_version")
      .notNull()
      .default(sql`1`),
    capabilities: text("capabilities", { mode: "json" })
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'`),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("executors_token_hash_unique").on(table.tokenHash),
    uniqueIndex("executors_name_unique").on(table.name),
    uniqueIndex("executors_project_id_unique").on(table.projectId),
  ],
);

export const workspaceSettings = sqliteTable(
  "workspace_settings",
  {
    id: text("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "cascade",
      }),
    executionPool: text("execution_pool")
      .notNull()
      .default(sql`'shared'`),
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    maxConcurrentRuns: integer("max_concurrent_runs")
      .notNull()
      .default(sql`4`),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_settings_workspace_id_unique").on(table.workspaceId),
  ],
);
