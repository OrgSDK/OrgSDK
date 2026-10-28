import { and, eq } from "drizzle-orm";
import { invitations, memberships, users } from "../db/schema/core";
import type { AppDatabase } from "../db/database";

export function memberQuery(
  database: AppDatabase,
  workspaceId: number,
  id?: number,
) {
  return database
    .select({
      id: memberships.id,
      user_id: users.id,
      email: users.email,
      username: users.username,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        id === undefined ? undefined : eq(memberships.id, id),
      ),
    );
}
export function membershipForUser(
  database: AppDatabase,
  workspaceId: number,
  userId: number,
) {
  return database
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.userId, userId),
      ),
    )
    .get();
}
export function membershipById(
  database: AppDatabase,
  workspaceId: number,
  id: number,
) {
  return database
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.workspaceId, workspaceId), eq(memberships.id, id)),
    )
    .get();
}
export function createMembership(
  database: AppDatabase,
  values: typeof memberships.$inferInsert,
): void {
  database.insert(memberships).values(values).run();
}
export function setMembershipRole(
  database: AppDatabase,
  workspaceId: number,
  id: number,
  role: (typeof memberships.$inferInsert)["role"],
): void {
  database
    .update(memberships)
    .set({ role })
    .where(
      and(eq(memberships.workspaceId, workspaceId), eq(memberships.id, id)),
    )
    .run();
}
export function updateInvitation(
  database: AppDatabase,
  workspaceId: number,
  id: number,
  changes: Partial<
    Pick<typeof invitations.$inferInsert, "acceptedAt" | "revokedAt">
  >,
): void {
  database
    .update(invitations)
    .set(changes)
    .where(
      and(eq(invitations.workspaceId, workspaceId), eq(invitations.id, id)),
    )
    .run();
}
