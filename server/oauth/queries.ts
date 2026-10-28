import { and, eq, lt } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { oauthAttempts, plugins } from "../db/schema";

export function oauthQueries(database: AppDatabase, workspaceId: number) {
  return {
    installedPlugin(id: string) {
      return database
        .select()
        .from(plugins)
        .where(and(eq(plugins.id, id), eq(plugins.workspaceId, workspaceId)))
        .get();
    },
    removeExpiredAttempts() {
      database
        .delete(oauthAttempts)
        .where(
          and(
            eq(oauthAttempts.workspaceId, workspaceId),
            lt(oauthAttempts.expiresAt, Date.now()),
          ),
        )
        .run();
    },
    createAttempt(
      input: Omit<typeof oauthAttempts.$inferInsert, "workspaceId">,
    ) {
      database
        .insert(oauthAttempts)
        .values({ ...input, workspaceId })
        .run();
    },
  };
}
