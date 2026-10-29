import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sessions, users, workspaces } from "./core";
import { plugins } from "./plugins";

export const oauthAttempts = sqliteTable("oauth_attempts", {
  stateDigest: text("state_digest").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references((): AnySQLiteColumn => users.id, { onDelete: "no action" }),
  workspaceId: integer("workspace_id")
    .notNull()
    .references((): AnySQLiteColumn => workspaces.id, {
      onDelete: "no action",
    }),
  pluginId: text("plugin_id")
    .notNull()
    .references((): AnySQLiteColumn => plugins.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references((): AnySQLiteColumn => sessions.id, { onDelete: "cascade" }),
  encryptedPayload: text("encrypted_payload").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
