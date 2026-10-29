import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { memberships, users } from "../db/schema";

export function auditQueries(database: AppDatabase, workspaceId: number) {
  return {
    actor(userId: number | null) {
      if (userId === null) {
        return undefined;
      }
      return database
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.userId, userId),
          ),
        )
        .get();
    },
  };
}
