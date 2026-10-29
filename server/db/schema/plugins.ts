import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { JsonObject, PluginMetadata } from "../types";
import { workspaces } from "./core";
import { projects } from "./projects";

export const plugins = sqliteTable(
  "plugins",
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
    slug: text("slug").notNull(),
    version: text("version").notNull(),
    description: text("description")
      .notNull()
      .default(sql`''`),
    source: text("source")
      .notNull()
      .default(sql`''`),
    digest: text("digest").notNull(),
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    credentialId: text("credential_id").references(
      (): AnySQLiteColumn => credentials.id,
      { onDelete: "set null" },
    ),
    configuration: text("configuration", { mode: "json" })
      .notNull()
      .$type<JsonObject>()
      .default(sql`'{}'`),
    releaseMetadata: text("release_metadata", { mode: "json" })
      .notNull()
      .$type<PluginMetadata>()
      .default(sql`'{}'`),
    packageUrl: text("package_url")
      .notNull()
      .default(sql`''`),
    distribution: text("distribution")
      .notNull()
      .default(sql`'inline'`),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("plugins_project_id_slug_unique").on(
      table.projectId,
      table.slug,
    ),
  ],
);

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  encryptedSecret: text("encrypted_secret").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
