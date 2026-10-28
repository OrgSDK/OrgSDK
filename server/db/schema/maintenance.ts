import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mailOutbox = sqliteTable(
  "mail_outbox",
  {
    id: text("id").primaryKey(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttempt: integer("next_attempt").notNull(),
    leaseUntil: integer("lease_until"),
    sentAt: integer("sent_at"),
    lastError: text("last_error"),
  },
  (table) => [
    index("mail_outbox_due_idx")
      .on(table.nextAttempt)
      .where(sql`${table.sentAt} IS NULL`),
  ],
);

export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
