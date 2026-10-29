import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { users } from "../db/schema/core";
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
