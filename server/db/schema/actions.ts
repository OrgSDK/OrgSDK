import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { JsonObject } from "../types";
import { workspaces } from "./core";
import { projects } from "./projects";
import { runs } from "./runs";

export const actions = sqliteTable("actions", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references((): AnySQLiteColumn => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description")
    .notNull()
    .default(sql`''`),
  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .default(sql`1`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const actionVersions = sqliteTable(
  "action_versions",
  {
    id: text("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "cascade",
      }),
    actionId: text("action_id")
      .notNull()
      .references((): AnySQLiteColumn => actions.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    source: text("source").notNull(),
    inputSchema: text("input_schema", { mode: "json" })
      .notNull()
      .$type<JsonObject>()
      .default(sql`'{}'`),
    outputSchema: text("output_schema", { mode: "json" })
      .notNull()
      .$type<JsonObject>()
      .default(sql`'{}'`),
    validationMode: text("validation_mode")
      .notNull()
      .default(sql`'legacy'`),
    sdkContract: text("sdk_contract", { mode: "json" })
      .notNull()
      .$type<JsonObject>()
      .default(sql`'{}'`),
    promotedFrom: text("promoted_from").references(
      (): AnySQLiteColumn => runs.id,
      { onDelete: "restrict" },
    ),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("action_versions_action_id_number_unique").on(
      table.actionId,
      table.number,
    ),
  ],
);

export const actionTestSuites = sqliteTable(
  "action_test_suites",
  {
    id: text("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "cascade",
      }),
    versionId: text("version_id")
      .notNull()
      .references((): AnySQLiteColumn => actionVersions.id, {
        onDelete: "cascade",
      }),
    number: integer("number").notNull(),
    cases: text("cases", { mode: "json" }).notNull().$type<JsonObject[]>(),
    digest: text("digest").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("action_test_suites_version_id_number_unique").on(
      table.versionId,
      table.number,
    ),
  ],
);
