import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
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
  },
  (table) => [
    uniqueIndex("users_email_unique").on(sql`${table.email} COLLATE NOCASE`),
    uniqueIndex("users_username_unique").on(
      sql`${table.username} COLLATE NOCASE`,
    ),
  ],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    host: text("host").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspaces_host_unique").on(sql`${table.host} COLLATE NOCASE`),
  ],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "no action",
      }),
    userId: integer("user_id")
      .notNull()
      .references((): AnySQLiteColumn => users.id, { onDelete: "no action" }),
    role: text("role").notNull(),
  },
  (table) => [
    uniqueIndex("one_workspace_owner")
      .on(table.workspaceId)
      .where(sql`${table.role}='owner'`),
    uniqueIndex("memberships_workspace_id_user_id_unique").on(
      table.workspaceId,
      table.userId,
    ),
    check(
      "memberships_role_check",
      sql`${table.role} IN ('owner','admin','member')`,
    ),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references((): AnySQLiteColumn => users.id, {
    onDelete: "no action",
  }),
  pendingUserId: integer("pending_user_id").references(
    (): AnySQLiteColumn => users.id,
    { onDelete: "no action" },
  ),
  workspaceId: integer("workspace_id").references(
    (): AnySQLiteColumn => workspaces.id,
    { onDelete: "no action" },
  ),
  expiresAt: integer("expires_at").notNull(),
  reauthenticatedAt: integer("reauthenticated_at"),
});

export const invitations = sqliteTable(
  "invitations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.id, {
        onDelete: "no action",
      }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenDigest: text("token_digest").notNull(),
    expiresAt: text("expires_at").notNull(),
    acceptedAt: text("accepted_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("one_pending_invitation")
      .on(table.workspaceId, sql`${table.email} COLLATE NOCASE`)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    uniqueIndex("invitations_token_digest_unique").on(table.tokenDigest),
    check("invitations_role_check", sql`${table.role} IN ('admin','member')`),
  ],
);
