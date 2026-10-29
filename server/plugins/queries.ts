import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { memberships, plugins, sessions } from "../db/schema";

export function pluginQueries(database: AppDatabase, workspaceId: number) {
  return {
    listEnabledForProject(projectId: string) {
      return database
        .select()
        .from(plugins)
        .where(
          and(
            eq(plugins.workspaceId, workspaceId),
            eq(plugins.projectId, projectId),
            eq(plugins.enabled, true),
          ),
        )
        .orderBy(asc(plugins.slug))
        .all();
    },
    hasManagerAccess(userId: number) {
      return (
        database
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, workspaceId),
              eq(memberships.userId, userId),
              inArray(memberships.role, ["owner", "admin"]),
            ),
          )
          .limit(1)
          .get() !== undefined
      );
    },
    hasActiveSession(sessionId: string, userId: number) {
      return (
        database
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.id, sessionId),
              eq(sessions.userId, userId),
              gt(sessions.expiresAt, Date.now()),
            ),
          )
          .get() !== undefined
      );
    },
  };
}
