import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { JsonObject, TableColumn } from "../types";
import { workspaces } from "./core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content")
    .notNull()
    .default(sql`''`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceTables = sqliteTable("workspace_tables", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  columns: text("columns", { mode: "json" }).notNull().$type<TableColumn[]>(),
  revision: integer("revision")
    .notNull()
    .default(sql`1`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tableRows = sqliteTable("table_rows", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  tableId: text("table_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaceTables.id, {
      onDelete: "cascade",
    }),
  values: text("values", { mode: "json" }).notNull().$type<JsonObject>(),
  revision: integer("revision")
    .notNull()
    .default(sql`1`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
