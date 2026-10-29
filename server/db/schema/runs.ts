import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { JsonObject, JsonValue } from "../types";
import { actionVersions } from "./actions";
import { users, workspaces } from "./core";
import { executors, projects } from "./projects";
import { accessTokens } from "./tokens";

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: "restrict" }),
    actorId: integer("actor_id")
      .notNull()
      .references((): AnySQLiteColumn => users.id, { onDelete: "restrict" }),
    tokenId: text("token_id").references(
      (): AnySQLiteColumn => accessTokens.id,
      { onDelete: "restrict" },
    ),
    actionVersionId: text("action_version_id").references(
      (): AnySQLiteColumn => actionVersions.id,
      { onDelete: "restrict" },
    ),
    operation: text("operation").notNull(),
    origin: text("origin")
      .notNull()
      .default(sql`'browser'`),
    originReference: text("origin_reference")
      .notNull()
      .default(sql`''`),
    inputs: text("inputs", { mode: "json" })
      .notNull()
      .$type<JsonObject>()
      .default(sql`'{}'`),
    snapshot: text("snapshot", { mode: "json" })
      .notNull()
      .$type<JsonObject>()
      .default(sql`'{}'`),
    status: text("status")
      .notNull()
      .default(sql`'queued'`),
    output: text("output", { mode: "json" })
      .notNull()
      .$type<JsonValue>()
      .default(sql`'{}'`),
    error: text("error")
      .notNull()
      .default(sql`''`),
    idempotencyKey: text("idempotency_key").notNull(),
    idempotencyNamespace: text("idempotency_namespace")
      .notNull()
      .default(sql`''`),
    retryOf: text("retry_of").references((): AnySQLiteColumn => runs.id, {
      onDelete: "set null",
    }),
    cancelRequested: integer("cancel_requested", { mode: "boolean" })
      .notNull()
      .default(sql`0`),
    executorId: text("executor_id").references(
      (): AnySQLiteColumn => executors.id,
      { onDelete: "set null" },
    ),
    leaseExpiresAt: text("lease_expires_at"),
    deadline: text("deadline"),
    capabilityHash: text("capability_hash")
      .notNull()
      .default(sql`''`),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("runs_queue_idx").on(
      table.workspaceId,
      table.projectId,
      table.status,
      table.createdAt,
    ),
    index("runs_active_idx").on(table.workspaceId, table.status),
    uniqueIndex(
      "runs_workspace_id_idempotency_namespace_idempotency_key_unique",
    ).on(table.workspaceId, table.idempotencyNamespace, table.idempotencyKey),
    check(
      "runs_status_check",
      sql`${table.status} in ('queued','running','waiting_approval','succeeded','failed','cancelled','interrupted')`,
    ),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "cascade",
      }),
    runId: text("run_id")
      .notNull()
      .references((): AnySQLiteColumn => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    data: text("data", { mode: "json" })
      .notNull()
      .$type<JsonObject>()
      .default(sql`'{}'`),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("run_events_run_id_sequence_unique").on(
      table.runId,
      table.sequence,
    ),
  ],
);

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  runId: text("run_id")
    .notNull()
    .references((): AnySQLiteColumn => runs.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  status: text("status")
    .notNull()
    .default(sql`'pending'`),
  decidedBy: integer("decided_by").references((): AnySQLiteColumn => users.id, {
    onDelete: "restrict",
  }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  runId: text("run_id")
    .notNull()
    .references((): AnySQLiteColumn => runs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  content: text("content").notNull(),
  mediaType: text("media_type")
    .notNull()
    .default(sql`'text/plain'`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
