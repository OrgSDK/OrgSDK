import { and, eq, isNull, sql } from "drizzle-orm";
import { invitations, memberships, users, workspaces } from "../db/schema/core";
import type { AppDatabase } from "../db/database";

function memberQuery(database: AppDatabase, workspaceId: number, id?: number) {
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
export function memberRows(database: AppDatabase, workspaceId: number) {
  return memberQuery(database, workspaceId).all();
}
export function memberRow(
  database: AppDatabase,
  workspaceId: number,
  id: number,
) {
  return memberQuery(database, workspaceId, id).get();
}

export function hasMemberEmail(
  database: AppDatabase,
  workspaceId: number,
  email: string,
): boolean {
  return (
    database
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          sql`lower(${users.email}) = ${email}`,
        ),
      )
      .get() !== undefined
  );
}

export function pendingInvitationsByEmail(
  database: AppDatabase,
  workspaceId: number,
  email: string,
) {
  return database
    .select({ id: invitations.id, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        sql`lower(${invitations.email}) = ${email}`,
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .all();
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
export function removeMembership(
  database: AppDatabase,
  workspaceId: number,
  id: number,
): void {
  database
    .delete(memberships)
    .where(
      and(eq(memberships.workspaceId, workspaceId), eq(memberships.id, id)),
    )
    .run();
}
export function createWorkspace(
  database: AppDatabase,
  values: typeof workspaces.$inferInsert,
) {
  return database.insert(workspaces).values(values).returning().get();
}
export function renameWorkspace(
  database: AppDatabase,
  workspaceId: number,
  name: string,
) {
  return database
    .update(workspaces)
    .set({ name })
    .where(eq(workspaces.id, workspaceId))
    .returning()
    .get();
}
export function listInvitations(database: AppDatabase, workspaceId: number) {
  return database
    .select()
    .from(invitations)
    .where(eq(invitations.workspaceId, workspaceId))
    .all();
}
export function invitationById(
  database: AppDatabase,
  workspaceId: number,
  id: number,
) {
  return database
    .select()
    .from(invitations)
    .where(
      and(eq(invitations.workspaceId, workspaceId), eq(invitations.id, id)),
    )
    .get();
}
export function invitationByToken(
  database: AppDatabase,
  workspaceId: number,
  tokenDigest: string,
) {
  return database
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.tokenDigest, tokenDigest),
      ),
    )
    .get();
}
export function createInvitation(
  database: AppDatabase,
  values: typeof invitations.$inferInsert,
) {
  return database.insert(invitations).values(values).returning().get();
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
