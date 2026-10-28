import { eq, or } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { sessions, users } from "../db/schema/core";
export function createAccount(
  database: AppDatabase,
  values: typeof users.$inferInsert,
) {
  return database.insert(users).values(values).returning().get();
}
export function updateAccount(
  database: AppDatabase,
  userId: number,
  changes: Partial<Omit<typeof users.$inferInsert, "id">>,
) {
  return database
    .update(users)
    .set(changes)
    .where(eq(users.id, userId))
    .returning()
    .get();
}
export function revokeAccountSessions(
  database: AppDatabase,
  userId: number,
): void {
  database
    .delete(sessions)
    .where(or(eq(sessions.userId, userId), eq(sessions.pendingUserId, userId)))
    .run();
}
export function removeSession(database: AppDatabase, sessionId: string): void {
  database.delete(sessions).where(eq(sessions.id, sessionId)).run();
}
