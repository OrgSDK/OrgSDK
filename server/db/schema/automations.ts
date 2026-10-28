import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { JsonObject } from "../types";
import { actions, actionVersions } from "./actions";
import { users, workspaces } from "./core";
import { runs } from "./runs";

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  actionId: text("action_id")
    .notNull()
    .references((): AnySQLiteColumn => actions.id, { onDelete: "cascade" }),
  actorId: integer("actor_id")
    .notNull()
    .references((): AnySQLiteColumn => users.id, { onDelete: "restrict" }),
  cron: text("cron").notNull(),
  inputs: text("inputs", { mode: "json" })
    .notNull()
    .$type<JsonObject>()
    .default(sql`'{}'`),
  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .default(sql`1`),
  nextRunAt: text("next_run_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  actionVersionId: text("action_version_id")
    .notNull()
    .references((): AnySQLiteColumn => actionVersions.id, {
      onDelete: "restrict",
    }),
  actorId: integer("actor_id")
    .notNull()
    .references((): AnySQLiteColumn => users.id, { onDelete: "restrict" }),
  secretHash: text("secret_hash").notNull(),
  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .default(sql`1`),
  rotatedAt: text("rotated_at").notNull(),
  lastReceivedAt: text("last_received_at"),
  lastAcceptedAt: text("last_accepted_at"),
  lastRejection: text("last_rejection")
    .notNull()
    .default(sql`''`),
  lastRejectedAt: text("last_rejected_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "cascade",
      }),
    webhookId: text("webhook_id")
      .notNull()
      .references((): AnySQLiteColumn => webhooks.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    outcome: text("outcome").notNull(),
    runId: text("run_id").references((): AnySQLiteColumn => runs.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_webhook_id_delivery_id_unique").on(
      table.webhookId,
      table.deliveryId,
    ),
  ],
);
