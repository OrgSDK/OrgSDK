import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  totpSecret: text("totp_secret"),
  pendingTotpSecret: text("pending_totp_secret"),
  totpLastCounter: integer("totp_last_counter"),
  recoveryCodes: text("recovery_codes").notNull().default("[]"),
});
export const workspaces = sqliteTable("workspaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  host: text("host").notNull(),
  createdAt: text("created_at").notNull(),
});
export const memberships = sqliteTable("memberships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull(),
});
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  pendingUserId: integer("pending_user_id").references(() => users.id),
  workspaceId: integer("workspace_id").references(() => workspaces.id),
  expiresAt: integer("expires_at").notNull(),
  reauthenticatedAt: integer("reauthenticated_at"),
});
export const invitations = sqliteTable("invitations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenDigest: text("token_digest").notNull(),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  revokedAt: text("revoked_at"),
});
export const coreDDL = `
CREATE TABLE mail_outbox (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, lease_until INTEGER, sent_at INTEGER, last_error TEXT);
CREATE TABLE auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', totp_secret TEXT, pending_totp_secret TEXT, totp_last_counter INTEGER, recovery_codes TEXT NOT NULL DEFAULT '[]');
CREATE TABLE workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL);
CREATE TABLE memberships (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL REFERENCES workspaces(id), user_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('owner','admin','member')), UNIQUE(workspace_id,user_id));
CREATE UNIQUE INDEX one_workspace_owner ON memberships(workspace_id) WHERE role='owner';
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), pending_user_id INTEGER REFERENCES users(id), workspace_id INTEGER REFERENCES workspaces(id), expires_at INTEGER NOT NULL, reauthenticated_at INTEGER);
CREATE TABLE invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), token_digest TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, accepted_at TEXT, revoked_at TEXT);
CREATE UNIQUE INDEX one_pending_invitation ON invitations(workspace_id, email COLLATE NOCASE) WHERE accepted_at IS NULL AND revoked_at IS NULL;
`;
