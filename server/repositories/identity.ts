import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import {
  mcpAccessTokenDigest,
  type McpAccessToken,
} from "../tokens/access-token";
import { accessTokens } from "../db/schema";
import { memberships, sessions, users, workspaces } from "../db/schema/core";

export function identityRepository(database: AppDatabase) {
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
    activeClientToken(workspaceId: number, token: McpAccessToken) {
      const tokenDigest = mcpAccessTokenDigest(token);
      return database
        .select()
        .from(accessTokens)
        .where(
          and(
            eq(accessTokens.digest, tokenDigest),
            eq(accessTokens.workspaceId, workspaceId),
            eq(accessTokens.revoked, false),
          ),
        )
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
