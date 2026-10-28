import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { users, workspaces } from "./core";

export const accessTokens = sqliteTable(
  "access_tokens",
  {
    id: text("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "cascade",
      }),
    actorId: integer("actor_id")
      .notNull()
      .references((): AnySQLiteColumn => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    digest: text("digest").notNull(),
    scopes: text("scopes", { mode: "json" }).notNull().$type<string[]>(),
    projects: text("projects", { mode: "json" })
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'`),
    actionVersions: text("action_versions", { mode: "json" })
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'`),
    revoked: integer("revoked", { mode: "boolean" })
      .notNull()
      .default(sql`0`),
    firstUsedAt: text("first_used_at"),
    lastUsedAt: text("last_used_at"),
    requestCount: integer("request_count")
      .notNull()
      .default(sql`0`),
    successCount: integer("success_count")
      .notNull()
      .default(sql`0`),
    errorCount: integer("error_count")
      .notNull()
      .default(sql`0`),
    trpcRequestCount: integer("trpc_request_count")
      .notNull()
      .default(sql`0`),
    mcpRequestCount: integer("mcp_request_count")
      .notNull()
      .default(sql`0`),
    lastTransport: text("last_transport")
      .notNull()
      .default(sql`''`),
    lastOutcome: text("last_outcome")
      .notNull()
      .default(sql`''`),
    lastStatusCode: integer("last_status_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("access_tokens_digest_unique").on(table.digest)],
);
