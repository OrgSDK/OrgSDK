import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { users, workspaces, sessions } from "./core";
import { plugins } from "./domain";
export const oauthAttempts = sqliteTable("oauth_attempts", {
  stateDigest: text("state_digest").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  pluginId: text("plugin_id")
    .notNull()
    .references(() => plugins.id),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  encryptedPayload: text("encrypted_payload").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const oauthDDL = `CREATE TABLE IF NOT EXISTS oauth_attempts (
 state_digest TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
 plugin_id TEXT NOT NULL REFERENCES domain_plugins(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 encrypted_payload TEXT NOT NULL, expires_at INTEGER NOT NULL
);`;
