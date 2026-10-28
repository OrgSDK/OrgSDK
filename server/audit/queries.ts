import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { auditRecords, memberships, users } from "../db/schema";
import type { AuditFilters } from "./schemas";

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
    list(filters: AuditFilters) {
      return database
        .select()
        .from(auditRecords)
        .where(
          and(
            eq(auditRecords.workspaceId, workspaceId),
            filters.actor === undefined
              ? undefined
              : eq(auditRecords.actorId, filters.actor),
            filters.kind === undefined
              ? undefined
              : eq(auditRecords.action, filters.kind),
            filters.object_id === undefined
              ? undefined
              : eq(auditRecords.resource, filters.object_id),
            filters.since === undefined
              ? undefined
              : gte(auditRecords.createdAt, filters.since),
            filters.before === undefined
              ? undefined
              : lt(auditRecords.createdAt, filters.before),
          ),
        )
        .orderBy(desc(auditRecords.createdAt))
        .all();
    },
  };
}
