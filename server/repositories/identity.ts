import { and, eq } from "drizzle-orm";
import type { Store } from "../db";
import { accessTokens } from "../db/schema";
import { memberships, sessions, users, workspaces } from "../db/schema/core";

export function identityRepository(store: Store) {
  const database = store.db;
  return {
    workspaceForHost(host: string) {
      return database
        .select()
        .from(workspaces)
        .where(eq(workspaces.host, host))
        .get();
    },
    anyWorkspace() {
      return database.select().from(workspaces).get();
    },
    user(id: number) {
      return database.select().from(users).where(eq(users.id, id)).get();
    },
    userByEmail(email: string) {
      return database.select().from(users).where(eq(users.email, email)).get();
    },
    session(id: string) {
      return database.select().from(sessions).where(eq(sessions.id, id)).get();
    },
    tokenByDigest(digest: string) {
      return database
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.digest, digest))
        .get();
    },
    membership(workspaceId: number, userId: number) {
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
    },
  };
}
