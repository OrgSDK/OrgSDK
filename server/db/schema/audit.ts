import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { JsonObject } from "../types";
import { users, workspaces } from "./core";
import { projects } from "./projects";

export const auditRecords = sqliteTable("audit_records", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references((): AnySQLiteColumn => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  data: text("data", { mode: "json" })
    .notNull()
    .$type<JsonObject>()
    .default(sql`'{}'`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references((): AnySQLiteColumn => projects.id, { onDelete: "restrict" }),
  title: text("title")
    .notNull()
    .default(sql`'New conversation'`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
